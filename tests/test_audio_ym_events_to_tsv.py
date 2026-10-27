import importlib.util
import json
import unittest
from pathlib import Path
SOURCE=Path(__file__).resolve().parents[1]/"scripts/audio_ym_events_to_tsv.py"
spec=importlib.util.spec_from_file_location("audio_ym_events_to_tsv",SOURCE)
converter=importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)

class YMEventTapeTests(unittest.TestCase):
    def test_timeline_and_ports(self):
        lines=[
            json.dumps({"kind":"SOUNDLATCH_WRITE","tick12m":5,"value":1}),
            json.dumps({"kind":"YM2203_WRITE","tick12m":6,"address":57344,"value":40}),
            json.dumps({"kind":"YM2203_WRITE","tick12m":6,"address":57345,"value":170}),
            json.dumps({"kind":"YM2203_WRITE","tick12m":10,"address":57346,"value":44})]
        self.assertEqual(converter.convert(lines),[(6,0xe000,40),(6,0xe001,170),(10,0xe002,44)])
    def test_b3_absolute_private_output_accepted_without_widening_scope(self):
        root=converter.ROOT
        requested=root/"out"/"audio"/"b3-ym-events.tsv"
        self.assertEqual(converter.safe_private_output(requested),requested)
        self.assertEqual(converter.safe_private_output(Path("out/audio/b3-ym-events.tsv")),requested)
        with self.assertRaises(ValueError):
            converter.safe_private_output(root/"docs"/"not-private.tsv")
        with self.assertRaises(ValueError):
            converter.safe_private_output(Path("out/audio/../not-private.tsv"))
        with self.assertRaises(ValueError):
            converter.safe_private_output(Path("/tmp/not-private.tsv"))

    def test_non_monotonic_rejected(self):
        lines=[
            json.dumps({"kind":"YM2203_WRITE","tick12m":10,"address":0xe000,"value":1}),
            json.dumps({"kind":"YM2203_WRITE","tick12m":9,"address":0xe001,"value":1})]
        with self.assertRaises(ValueError): converter.convert(lines)
    def test_empty_and_forged_rejected(self):
        with self.assertRaises(ValueError):
            converter.convert([json.dumps({"kind":"YM2203_WRITE","tick12m":1,"address":0xc800,"value":2})])
        with self.assertRaises(ValueError):
            converter.convert([json.dumps({"kind":"Z80_LATCH_READ","value":1})])

if __name__=="__main__": unittest.main()
