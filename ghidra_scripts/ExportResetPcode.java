// @category GNG
// Run after importing out/gngb-flat.bin as 6809:BE:16:default, base 0.
// This exporter is diagnostic: main translation path is the strict opcode lifter.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.pcode.PcodeOp;
import ghidra.program.model.pcode.Varnode;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.File;
import java.io.FileWriter;

public class ExportResetPcode extends GhidraScript {
    private String vn(Varnode node) { return node == null ? null : node.toString(); }

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("Expected output path");
        if (!currentProgram.getLanguageID().toString().equals("6809:BE:16:default"))
            throw new IllegalStateException("Wrong CPU language: " + currentProgram.getLanguageID());
        JsonObject root = new JsonObject();
        root.addProperty("schema", "gng.ghidra-pcode.v1");
        root.addProperty("processor", currentProgram.getLanguageID().toString());
        root.addProperty("start", "0x6002");
        root.addProperty("end_exclusive", "0x6014");
        JsonArray instructions = new JsonArray();
        for (int pc = 0x6002; pc < 0x6014;) {
            Address addr = toAddr(pc);
            Instruction inst = currentProgram.getListing().getInstructionAt(addr);
            if (inst == null) {
                disassemble(addr);
                inst = currentProgram.getListing().getInstructionAt(addr);
            }
            if (inst == null) throw new IllegalStateException("Cannot decode 0x" + Integer.toHexString(pc));
            int len = inst.getLength();
            if (len <= 0 || pc + len > 0x6014)
                throw new IllegalStateException("Invalid instruction boundary at 0x" + Integer.toHexString(pc));
            JsonObject record = new JsonObject();
            record.addProperty("address", String.format("0x%04x", pc));
            record.addProperty("assembly", inst.toString());
            StringBuilder bytes = new StringBuilder();
            for (byte b : inst.getBytes()) bytes.append(String.format("%02x", b & 0xff));
            record.addProperty("raw", bytes.toString());
            JsonArray operations = new JsonArray();
            for (PcodeOp op : inst.getPcode()) {
                JsonObject o = new JsonObject();
                o.addProperty("op", op.getMnemonic());
                if (op.getOutput() != null) o.addProperty("output", vn(op.getOutput()));
                JsonArray inputs = new JsonArray();
                for (int i = 0; i < op.getNumInputs(); ++i) inputs.add(vn(op.getInput(i)));
                o.add("inputs", inputs);
                operations.add(o);
            }
            if (operations.size() == 0)
                throw new IllegalStateException("No P-code produced for 0x" + Integer.toHexString(pc));
            record.add("pcode", operations);
            instructions.add(record);
            pc += len;
        }
        root.add("instructions", instructions);
        File dst = new File(args[0]);
        File parent = dst.getAbsoluteFile().getParentFile();
        if (!parent.isDirectory()) throw new IllegalStateException("Output directory missing: " + parent);
        try (FileWriter w = new FileWriter(dst)) { w.write(root.toString()); }
        println("GNG_PCODE_EXPORT=PASS " + dst.getAbsolutePath());
    }
}
