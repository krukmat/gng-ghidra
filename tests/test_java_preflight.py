"""Minimal javac preflight for Ghidra Java scripts (not a Ghidra runtime test).

Stub API shapes catch Java compile errors without downloading the 570-MB Ghidra
package or committing game ROMs. Real Ghidra integration still runs on the Mac.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
EXPORTER = ROOT / 'ghidra_scripts/ExportFunctionGraph.java'
RESET_EXPORTER = ROOT / 'ghidra_scripts/ExportResetPcode.java'

# Package/class declarations. Only API shapes exercised by these two scripts.
STUBS = {
 'com.google.gson.JsonElement': '''public class JsonElement {
   public boolean getAsBoolean(){return false;} public int getAsInt(){return 0;}
   public String getAsString(){return null;}
   public com.google.gson.JsonObject getAsJsonObject(){return null;} }''',
 'com.google.gson.JsonArray': '''public class JsonArray extends JsonElement {
   public void add(String x) {} public void add(JsonObject x) {}
   public void add(JsonElement x) {} public int size(){return 0;}
   public JsonElement get(int index){return null;} }''',
 'com.google.gson.JsonObject': '''public class JsonObject extends JsonElement {
   public void addProperty(String k, String x) {} public void addProperty(String k, Number x) {}
   public void addProperty(String k, Boolean x) {} public void add(String k, JsonElement x) {}
   public JsonElement get(String k){return null;}
   public JsonArray getAsJsonArray(String k){return null;} }''',
 'ghidra.app.util.PseudoDisassembler': '''public class PseudoDisassembler {
   public PseudoDisassembler(ghidra.program.model.listing.Program program) {}
   public PseudoInstruction disassemble(ghidra.program.model.address.Address at) {return null;} }''',
 'ghidra.app.util.PseudoInstruction': '''public class PseudoInstruction
     extends ghidra.program.model.listing.Instruction {}''',
 'ghidra.app.script.GhidraScript': '''public abstract class GhidraScript {
   protected ghidra.program.model.listing.Program currentProgram;
   protected abstract void run() throws Exception;
   protected ghidra.program.model.address.Address toAddr(long x){return null;}
   protected boolean disassemble(ghidra.program.model.address.Address x){return false;}
   protected String[] getScriptArgs(){return null;} protected void println(String x){} }''',
 'ghidra.program.model.address.Address': '''public class Address {
   public boolean isMemoryAddress(){return true;} public long getOffset(){return 0;}
   public AddressSpace getAddressSpace(){return null;} }''',
 'ghidra.program.model.address.AddressSpace': '''public class AddressSpace {
   public String getName(){return null;} }''',
 'ghidra.program.model.address.AddressFactory': '''public class AddressFactory {
   public AddressSpace getAddressSpace(int x){return null;} }''',
 'ghidra.program.model.listing.Program': '''public class Program {
   public Object getLanguageID(){return null;}
   public ghidra.program.model.address.AddressFactory getAddressFactory(){return null;}
   public Listing getListing(){return null;}
   public ghidra.program.model.mem.Memory getMemory(){return null;} }''',
 'ghidra.program.model.listing.Listing': '''public class Listing {
   public Instruction getInstructionAt(ghidra.program.model.address.Address x){return null;} }''',
 'ghidra.program.model.listing.Instruction': '''public class Instruction {
   public int getLength(){return 0;}
   public ghidra.program.model.address.Address getAddress(){return null;}
   public ghidra.program.model.address.Address[] getFlows(){return null;}
   public ghidra.program.model.address.Address[] getDefaultFlows(){return null;}
   public ghidra.program.model.symbol.FlowType getFlowType(){return null;}
   public ghidra.program.model.address.Address getFallThrough(){return null;}
   public ghidra.program.model.pcode.PcodeOp[] getPcode(){return null;}
   public byte[] getBytes() throws ghidra.program.model.mem.MemoryAccessException{return null;}
   public String getMnemonicString(){return null;} }''',
 'ghidra.program.model.mem.Memory': '''public class Memory {
   public byte getByte(ghidra.program.model.address.Address x)
      throws MemoryAccessException{return 0;} }''',
 'ghidra.program.model.mem.MemoryAccessException': '''public class MemoryAccessException extends Exception {}''',
 'ghidra.program.model.pcode.PcodeOp': '''public class PcodeOp {
   public static final int LOAD=1, STORE=2;
   public int getOpcode(){return 0;} public String getMnemonic(){return null;}
   public Varnode getOutput(){return null;} public Varnode getInput(int x){return null;}
   public int getNumInputs(){return 0;} }''',
 'ghidra.program.model.pcode.Varnode': '''public class Varnode {
   public ghidra.program.model.address.Address getAddress(){return null;}
   public long getOffset(){return 0;} public int getSize(){return 0;} }''',
 'ghidra.program.model.symbol.FlowType': '''public class FlowType {
   public boolean isCall(){return false;} public boolean isComputed(){return false;} }''',
}


def compile_exporters(override_graph=None):
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        java_paths = []
        for qualified, declaration in STUBS.items():
            package, klass = qualified.rsplit('.', 1)
            path = home.joinpath(*package.split('.'), klass + '.java')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f'package {package};\n{declaration}\n')
            java_paths.append(str(path))
        script = home / 'ExportFunctionGraph.java'
        script.write_text(override_graph if override_graph is not None else EXPORTER.read_text())
        return subprocess.run(['javac', '-d', str(home / 'classes'), *java_paths,
                               str(script), str(RESET_EXPORTER)],
                              capture_output=True, text=True, timeout=40)


@unittest.skipUnless(shutil.which('javac'), 'Java JDK javac not installed')
class GhidraJavaPreflight(unittest.TestCase):
    def test_exporters_compile_with_minimal_api(self):
        proc = compile_exporters()
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_duplicate_call_queue_declaration_is_caught(self):
        src = EXPORTER.read_text()
        marker = '        JsonArray directCalls = new JsonArray();'
        self.assertIn(marker, src)
        proc = compile_exporters(src.replace(marker, '        JsonArray calls = new JsonArray();', 1))
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('variable calls is already defined', proc.stderr)


if __name__ == '__main__':
    unittest.main()
