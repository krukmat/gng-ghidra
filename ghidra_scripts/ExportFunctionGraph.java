// @category GNG
// Bounded 6809 ROM CFG traversal, without function autoanalysis or MAME.
// Arguments: <output-json> [0xENTRY ...]; default = 0x6000.
// ROM bank 4 is the only mapped bank. Calls are discovered, not inlined.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
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
    private static final int MAX_FUNCTIONS = 12;
    private static final int MAX_INSTRUCTIONS = 2500;
    private static final String CPU = "6809:BE:16:default";

    private String hex(long n) { return String.format("0x%x", n); }
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
    private JsonObject exportSeed(Address entry, ArrayDeque<Address> calls) {
        if (!inRom(entry)) throw new IllegalArgumentException("Outside ROM: " + entry);
        // Disassemble explicit seeds; no createFunction()/whole-program analyzer.
        ArrayDeque<Address> todo = new ArrayDeque<>();
        HashSet<Long> seen = new HashSet<>();
        ArrayList<Instruction> found = new ArrayList<>();
        todo.add(entry);
        while (!todo.isEmpty()) {
            Address pc = todo.removeFirst();
            if (!inRom(pc) || !seen.add(pc.getOffset())) continue;
            if (found.size() >= MAX_INSTRUCTIONS)
                throw new IllegalStateException("Instruction budget exceeded at " + entry);
            Instruction inst = currentProgram.getListing().getInstructionAt(pc);
            if (inst == null) {
                disassemble(pc);
                inst = currentProgram.getListing().getInstructionAt(pc);
            }
            if (inst == null) throw new IllegalStateException("Could not decode " + pc);
            if (inst.getAddress().getOffset() + inst.getLength() > 0x10000)
                throw new IllegalStateException("Instruction crosses image end: " + pc);
            found.add(inst);
            if (inst.getPcode().length == 0)
                throw new IllegalStateException("Missing P-code at " + pc);
            for (Address dest : inst.getFlows()) {
                if (!inRom(dest)) continue;
                if (inst.getFlowType().isCall()) calls.add(dest);
                else if (!inst.getFlowType().isComputed()) todo.add(dest);
            }
            Address fallthrough = inst.getFallThrough();
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
            if (inst.getFallThrough() != null)
                rec.addProperty("fallthrough", hex(inst.getFallThrough().getOffset()));
            JsonArray flows = new JsonArray();
            for (Address dest : inst.getFlows()) flows.add(hex(dest.getOffset()));
            rec.add("flows", flows);
            JsonArray micro = new JsonArray();
            for (PcodeOp op : inst.getPcode()) micro.add(pcodeOp(op));
            rec.add("pcode", micro);
            code.add(rec);
        }
        JsonObject f = new JsonObject();
        f.addProperty("entry", hex(entry.getOffset()));
        f.addProperty("name", "rom_" + Long.toHexString(entry.getOffset()));
        f.addProperty("bank_context", "bank4");
        f.addProperty("instruction_count", found.size());
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
        if (args.length == 1) pending.add(toAddr(0x6000));
        for (int i = 1; i < args.length; ++i) pending.add(toAddr(Long.decode(args[i])));
        HashSet<Long> seen = new HashSet<>();
        JsonArray exported = new JsonArray();
        JsonArray skipped = new JsonArray();
        while (!pending.isEmpty() && exported.size() < MAX_FUNCTIONS) {
            Address entry = pending.removeFirst();
            if (!seen.add(entry.getOffset())) continue;
            try {
                exported.add(exportSeed(entry, pending));
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
        root.addProperty("partial_discovery", !pending.isEmpty());
        root.add("functions", exported);
        root.add("skipped", skipped);
        File dest = new File(args[0]);
        File parent = dest.getAbsoluteFile().getParentFile();
        if (parent == null || !parent.isDirectory())
            throw new IllegalStateException("Output directory missing: " + dest);
        try (FileWriter w = new FileWriter(dest)) { w.write(root.toString()); }
        println("GNG_FUNCTION_EXPORT=" + (exported.size() > 0 ? "PASS" : "EMPTY") +
                " functions=" + exported.size() + " skipped=" + skipped.size() + " " + dest);
    }
}
