// @category GNG
// Headless extraction of real 6809 function CFG and typed raw P-code.
// Arguments: <output-json> [0xENTRY ...]. Defaults to reset vector 0x6000.
// No gameplay, emulator, or bank guessing. Banks 0-3 are NOT loaded.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.pcode.PcodeOp;
import ghidra.program.model.pcode.Varnode;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.File;
import java.io.FileWriter;
import java.util.ArrayDeque;
import java.util.HashSet;

public class ExportFunctionGraph extends GhidraScript {
    private static final int MAX_FUNCTIONS = 12;
    private static final int MAX_INSTRUCTIONS = 2500;
    private static final String CPU = "6809:BE:16:default";

    private String hex(long n) { return String.format("0x%x", n); }
    private boolean isRom(Address address) {
        if (address == null || !address.isMemoryAddress()) return false;
        long pc = address.getOffset();
        return pc >= 0x4000 && pc <= 0xffff;
    }
    private JsonObject variable(Varnode n) {
        JsonObject v = new JsonObject();
        v.addProperty("space", n.getAddress().getAddressSpace().getName());
        v.addProperty("offset", hex(n.getOffset()));
        v.addProperty("size", n.getSize());
        return v;
    }
    private JsonObject operation(PcodeOp op) {
        JsonObject p = new JsonObject();
        p.addProperty("op", op.getMnemonic());
        if (op.getOpcode() == PcodeOp.LOAD || op.getOpcode() == PcodeOp.STORE) {
            int spaceId = (int) op.getInput(0).getOffset();
            ghidra.program.model.address.AddressSpace space = currentProgram.getAddressFactory().getAddressSpace(spaceId);
            p.addProperty("space_name", space == null ? "unknown" : space.getName());
        }
        if (op.getOutput() != null) p.add("output", variable(op.getOutput()));
        JsonArray inputs = new JsonArray();
        for (int i = 0; i < op.getNumInputs(); ++i) inputs.add(variable(op.getInput(i)));
        p.add("inputs", inputs);
        return p;
    }
    private JsonObject exportFunction(Address entry, ArrayDeque<Address> pending) {
        if (!isRom(entry)) throw new IllegalStateException("Not in ROM: " + entry);
        if (currentProgram.getListing().getInstructionAt(entry) == null) disassemble(entry);
        Function function = getFunctionAt(entry);
        if (function == null) function = createFunction(entry, null);
        if (function == null) throw new IllegalStateException("Function not detected: " + entry);
        JsonObject f = new JsonObject();
        f.addProperty("entry", hex(entry.getOffset()));
        f.addProperty("name", function.getName());
        f.addProperty("bank_context", "bank4");
        JsonArray instructions = new JsonArray();
        InstructionIterator it = currentProgram.getListing().getInstructions(function.getBody(), true);
        int count = 0;
        while (it.hasNext()) {
            Instruction inst = it.next();
            if (++count > MAX_INSTRUCTIONS) throw new IllegalStateException("Function too large: " + entry);
            if (!isRom(inst.getAddress())) throw new IllegalStateException("Function enters RAM/I/O: " + inst.getAddress());
            JsonObject rec = new JsonObject();
            rec.addProperty("address", hex(inst.getAddress().getOffset()));
            rec.addProperty("length", inst.getLength());
            StringBuilder raw = new StringBuilder();
            for (byte b : inst.getBytes()) raw.append(String.format("%02x", b & 255));
            rec.addProperty("raw", raw.toString());
            rec.addProperty("assembly", inst.toString());
            rec.addProperty("flow_type", inst.getFlowType().toString());
            if (inst.getFallThrough() != null) rec.addProperty("fallthrough", hex(inst.getFallThrough().getOffset()));
            JsonArray flows = new JsonArray();
            for (Address dest : inst.getFlows()) {
                flows.add(hex(dest.getOffset()));
                if (inst.getFlowType().isCall() && isRom(dest)) pending.add(dest);
            }
            rec.add("flows", flows);
            JsonArray microcode = new JsonArray();
            for (PcodeOp op : inst.getPcode()) microcode.add(operation(op));
            if (microcode.size() == 0) throw new IllegalStateException("Missing P-code: " + inst.getAddress());
            rec.add("pcode", microcode);
            instructions.add(rec);
        }
        if (instructions.size() == 0) throw new IllegalStateException("Empty function: " + entry);
        f.add("instructions", instructions);
        f.addProperty("instruction_count", count);
        return f;
    }
    @Override
    protected void run() throws Exception {
        if (!CPU.equals(currentProgram.getLanguageID().toString()))
            throw new IllegalStateException("Expected " + CPU + ", got " + currentProgram.getLanguageID());
        String[] args = getScriptArgs();
        if (args.length == 0) throw new IllegalArgumentException("Expected output JSON path");
        ArrayDeque<Address> pending = new ArrayDeque<>();
        if (args.length == 1) pending.add(toAddr(0x6000));
        for (int i = 1; i < args.length; ++i) {
            long pc = Long.decode(args[i]);
            pending.add(toAddr(pc));
        }
        HashSet<Long> seen = new HashSet<>();
        JsonArray functions = new JsonArray();
        JsonArray skipped = new JsonArray();
        while (!pending.isEmpty() && functions.size() < MAX_FUNCTIONS) {
            Address entry = pending.removeFirst();
            if (!seen.add(entry.getOffset())) continue;
            try { functions.add(exportFunction(entry, pending)); }
            catch (Exception exc) {
                JsonObject err = new JsonObject();
                err.addProperty("entry", hex(entry.getOffset()));
                err.addProperty("reason", exc.toString());
                skipped.add(err);
            }
        }
        JsonObject root = new JsonObject();
        root.addProperty("schema", "gng.ghidra-functions.v1");
        root.addProperty("processor", CPU);
        root.addProperty("image", "gngb-flat.bin");
        root.addProperty("bank_context", "bank4");
        root.addProperty("partial_discovery", !pending.isEmpty());
        root.add("functions", functions);
        root.add("skipped", skipped);
        File dst = new File(args[0]);
        try (FileWriter w = new FileWriter(dst)) { w.write(root.toString()); }
        println("GNG_FUNCTION_EXPORT=PASS functions=" + functions.size() + " skipped=" + skipped.size() + " " + dst);
        if (functions.size() == 0) throw new IllegalStateException("No functions exported; inspect 'skipped'");
    }
}