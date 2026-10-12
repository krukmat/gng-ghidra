// @category GNG
// Bounded, deterministic ROM CFG traversal from explicit entry points.
// This deliberately avoids createFunction() and whole-program autoanalysis.
// Arguments: <output-json> [0xENTRY ...]; default = reset vector 0x6000.
// RAM/I/O and ROM bank contexts other than the bank-4 snapshot are NOT analyzed.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.mem.MemoryAccessException;
import ghidra.program.model.pcode.PcodeOp;
import ghidra.program.model.pcode.Varnode;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.File;
import java.io.FileWriter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;

public class ExportFunctionGraph extends GhidraScript {
    private static final int MAX_FUNCTIONS = 24;
    private static final int MAX_INSTRUCTIONS = 2500;
    private static final String CPU = "6809:BE:16:default";
    private static final String[] VECTOR_NAMES = {"SWI3", "SWI2", "FIRQ", "IRQ", "SWI", "NMI", "RESET"};
    private static final int[] VECTOR_ADDRS = {0xfff2, 0xfff4, 0xfff6, 0xfff8, 0xfffa, 0xfffc, 0xfffe};

    private String hex(long n) { return String.format("0x%x", n); }
    // Some Ghidra headless disassemblies omit an explicit fallthrough for
    // call instructions. A 6809 direct CALL returns to its next instruction
    // (assuming the callee returns); use that as a bounded discovery seed.
    // This is architectural inference, NOT confirmation that a call returns.
    private Address callContinuation(Instruction inst) {
        Address next = inst.getFallThrough();
        if (next == null && inst.getFlowType().isCall()) {
            long sequential = inst.getAddress().getOffset() + inst.getLength();
            if (sequential <= 0xffff) next = toAddr(sequential);
        }
        return next;
    }
    private boolean inRom(Address a) {
        return a != null && a.isMemoryAddress() &&
            a.getOffset() >= 0x4000 && a.getOffset() <= 0xffff;
    }
    private JsonObject varnode(Varnode n) {
        JsonObject v = new JsonObject();
        v.addProperty("space", n.getAddress().getAddressSpace().getName());
        v.addProperty("offset", hex(n.getOffset()));
        v.addProperty("size", n.getSize());
        return v;
    }
    private JsonObject pcodeOp(PcodeOp op) {
        JsonObject p = new JsonObject();
        p.addProperty("op", op.getMnemonic());
        if (op.getOpcode() == PcodeOp.LOAD || op.getOpcode() == PcodeOp.STORE) {
            int id = (int) op.getInput(0).getOffset();
            ghidra.program.model.address.AddressSpace space =
                currentProgram.getAddressFactory().getAddressSpace(id);
            p.addProperty("space_name", space == null ? "unknown" : space.getName());
        }
        if (op.getOutput() != null) p.add("output", varnode(op.getOutput()));
        JsonArray ins = new JsonArray();
        for (int i = 0; i < op.getNumInputs(); ++i) ins.add(varnode(op.getInput(i)));
        p.add("inputs", ins);
        return p;
    }
    private JsonObject exportSeed(Address entry, ArrayDeque<Address> calls) throws MemoryAccessException {
        if (!inRom(entry)) throw new IllegalArgumentException("Outside ROM: " + entry);
        // Disassemble from explicit seeds; function creation fails unreliably without autoanalysis.
        ArrayDeque<Address> todo = new ArrayDeque<>();
        HashSet<Long> seen = new HashSet<>();
        ArrayList<Instruction> found = new ArrayList<>();
        boolean truncated = false;
        todo.add(entry);
        while (!todo.isEmpty()) {
            Address pc = todo.removeFirst();
            if (!inRom(pc) || !seen.add(pc.getOffset())) continue;
            if (found.size() >= MAX_INSTRUCTIONS) {
                truncated = true;
                break;
            }
            Instruction inst = currentProgram.getListing().getInstructionAt(pc);
            if (inst == null) {
                disassemble(pc);
                inst = currentProgram.getListing().getInstructionAt(pc);
            }
            if (inst == null) throw new IllegalStateException("Could not decode " + pc);
            if (inst.getAddress().getOffset() + inst.getLength() > 0x10000)
                throw new IllegalStateException("Instruction crosses ROM image boundary " + pc);
            found.add(inst);
            // SLEIGH has legitimate empty semantic bodies for NOP and SYNC.
            // Preserve opaque instructions, never discard a whole CFG.
            // SYNC is an interrupt wait, NOT a NOP and not safe for codegen.
            for (Address dest : inst.getFlows()) {
                if (!inRom(dest)) continue;
                if (inst.getFlowType().isCall()) calls.add(dest);
                else if (!inst.getFlowType().isComputed()) todo.add(dest);
            }
            Address fallthrough = callContinuation(inst);
            if (inRom(fallthrough)) todo.add(fallthrough);
        }
        if (found.isEmpty()) throw new IllegalStateException("No instructions at " + entry);
        found.sort(Comparator.comparingLong(i -> i.getAddress().getOffset()));
        JsonArray code = new JsonArray();
        for (Instruction inst : found) {
            JsonObject rec = new JsonObject();
            rec.addProperty("address", hex(inst.getAddress().getOffset()));
            rec.addProperty("length", inst.getLength());
            StringBuilder raw = new StringBuilder();
            for (byte b : inst.getBytes()) raw.append(String.format("%02x", b & 0xff));
            rec.addProperty("raw", raw.toString());
            rec.addProperty("assembly", inst.toString());
            rec.addProperty("flow_type", inst.getFlowType().toString());
            Address physicalFallthrough = inst.getFallThrough();
            Address fallthrough = callContinuation(inst);
            if (fallthrough != null) {
                rec.addProperty("fallthrough", hex(fallthrough.getOffset()));
                if (physicalFallthrough == null && inst.getFlowType().isCall())
                    rec.addProperty("fallthrough_source", "6809-call-return-inferred");
            }
            JsonArray flows = new JsonArray();
            for (Address dest : inst.getFlows()) flows.add(hex(dest.getOffset()));
            rec.add("flows", flows);
            JsonArray micro = new JsonArray();
            for (PcodeOp op : inst.getPcode()) micro.add(pcodeOp(op));
            rec.add("pcode", micro);
            if (micro.size() == 0) {
                if ("12".equals(raw.toString()) && "NOP".equals(inst.getMnemonicString()))
                    rec.addProperty("pcode_status", "verified-nop");
                else if ("13".equals(raw.toString()) && "SYNC".equals(inst.getMnemonicString()))
                    rec.addProperty("pcode_status", "unmodeled-wait-for-interrupt");
                else
                    rec.addProperty("pcode_status", "unmodeled-empty-pcode");
            } else rec.addProperty("pcode_status", "native");
            code.add(rec);
        }
        JsonObject f = new JsonObject();
        f.addProperty("entry", hex(entry.getOffset()));
        f.addProperty("name", "rom_" + Long.toHexString(entry.getOffset()));
        f.addProperty("bank_context", "bank4");
        f.addProperty("instruction_count", found.size());
        f.addProperty("truncated", truncated);
        JsonArray directCalls = new JsonArray();
        for (Instruction ins : found) {
            if (!ins.getFlowType().isCall()) continue;
            for (Address target : ins.getFlows()) {
                if (!inRom(target)) continue;
                JsonObject c = new JsonObject();
                c.addProperty("caller_entry", hex(entry.getOffset()));
                c.addProperty("call_site", hex(ins.getAddress().getOffset()));
                c.addProperty("target", hex(target.getOffset()));
                c.addProperty("source", "ghidra-direct-call");
                directCalls.add(c);
            }
        }
        f.add("direct_calls", directCalls);
        f.add("instructions", code);
        return f;
    }
    @Override
    protected void run() throws Exception {
        if (!CPU.equals(currentProgram.getLanguageID().toString()))
            throw new IllegalStateException("Expected " + CPU + ", got " + currentProgram.getLanguageID());
        String[] args = getScriptArgs();
        if (args.length < 1) throw new IllegalArgumentException("Expected output JSON path");
        ArrayDeque<Address> pending = new ArrayDeque<>();
        JsonArray vectors = new JsonArray();
        for (int i = 0; i < VECTOR_ADDRS.length; ++i) {
            int vectorAddr = VECTOR_ADDRS[i];
            int hi = currentProgram.getMemory().getByte(toAddr(vectorAddr)) & 0xff;
            int lo = currentProgram.getMemory().getByte(toAddr(vectorAddr + 1)) & 0xff;
            int target = (hi << 8) | lo;
            // 0xffff is a sentinel in the verified gngb set, not a seed.
            boolean valid = target != 0xffff && inRom(toAddr(target));
            JsonObject v = new JsonObject();
            v.addProperty("name", VECTOR_NAMES[i]);
            v.addProperty("vector_address", hex(vectorAddr));
            v.addProperty("target", hex(target));
            v.addProperty("status", valid ? "mapped" : "unmapped-or-sentinel");
            vectors.add(v);
            if (args.length == 1 && valid) pending.add(toAddr(target));
        }
        if (args.length > 1)
            for (int i = 1; i < args.length; ++i) pending.add(toAddr(Long.decode(args[i])));
        HashSet<Long> seen = new HashSet<>();
        JsonArray exported = new JsonArray();
        JsonArray skipped = new JsonArray();
        boolean anyTruncated = false;
        while (!pending.isEmpty() && exported.size() < MAX_FUNCTIONS) {
            Address entry = pending.removeFirst();
            if (!seen.add(entry.getOffset())) continue;
            try {
                JsonObject exportedFunction = exportSeed(entry, pending);
                if (exportedFunction.get("truncated").getAsBoolean()) anyTruncated = true;
                exported.add(exportedFunction);
            } catch (Exception e) {
                JsonObject skip = new JsonObject();
                skip.addProperty("entry", hex(entry.getOffset()));
                skip.addProperty("reason", e.toString());
                skipped.add(skip);
                println("GNG_FUNCTION_SKIP=" + entry + " reason=" + e);
            }
        }
        JsonObject root = new JsonObject();
        root.addProperty("schema", "gng.ghidra-functions.v1");
        root.addProperty("processor", CPU);
        root.addProperty("image", "gngb-flat.bin");
        root.addProperty("bank_context", "bank4");
        root.addProperty("partial_discovery", !pending.isEmpty() || anyTruncated);
        root.add("functions", exported);
        root.add("skipped", skipped);
        root.add("vectors", vectors);
        root.addProperty("discovery_mode", "cpu-vectors-and-decoded-direct-calls");
        File dest = new File(args[0]);
        File parent = dest.getAbsoluteFile().getParentFile();
        if (parent == null || !parent.isDirectory())
            throw new IllegalStateException("Output directory missing: " + dest);
        try (FileWriter w = new FileWriter(dest)) { w.write(root.toString()); }
        println("GNG_FUNCTION_EXPORT=" + (exported.size() > 0 ? "PASS" : "EMPTY") +
                " functions=" + exported.size() + " skipped=" + skipped.size() + " " + dest);
    }
}
