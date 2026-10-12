"""P-code address-space identifiers can be wide without wide CPU data."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from pcode_codegen import emission, Unsupported

def v(space, offset, size):
    return {'space': space, 'offset': hex(offset), 'size': size}

class SpaceIdentifierTests(unittest.TestCase):
    def test_load_accepts_wide_metadata_not_wide_data(self):
        result = emission({'op':'LOAD','output':v('register',0,1),
                           'inputs':[v('const',1,8),v('register',10,2)], 'space_name':'ram'})
        self.assertIn('memRead(',result)
        self.assertNotIn('size:8',result)

    def test_store_accepts_wide_metadata_not_wide_data(self):
        result = emission({'op':'STORE','output':None,
                           'inputs':[v('const',1,8),v('register',10,2),v('register',0,1)],
                           'space_name':'ram'})
        self.assertIn('memWrite(',result)
        self.assertNotIn('size:8',result)

    def test_wide_pointer_output_or_arithmetic_still_fails(self):
        for p in [
            {'op':'LOAD','output':v('register',0,1),
             'inputs':[v('const',1,8),v('register',0,8)],'space_name':'ram'},
            {'op':'LOAD','output':v('register',0,8),
             'inputs':[v('const',1,8),v('register',0,2)],'space_name':'ram'},
            {'op':'STORE','output':None,
             'inputs':[v('const',1,8),v('register',0,2),v('register',8,8)],'space_name':'ram'},
            {'op':'COPY','output':v('register',0,2),'inputs':[v('const',0,8)]},
        ]:
            with self.subTest(op=p['op']):
                with self.assertRaisesRegex(Unsupported, '>32-bit'):
                    emission(p)

    def test_no_custom_bank_bypass(self):
        with self.assertRaisesRegex(Unsupported,'unknown memory space'):
            emission({'op':'LOAD','output':v('register',0,1),
                      'inputs':[v('const',1,8),v('register',10,2)], 'space_name':'bank0'})
