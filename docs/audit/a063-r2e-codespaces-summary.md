# A063 R2.E — Codespaces redacted diagnostic summary

Generated from local ROM-free evidence only. This report does not certify native MAME bank provenance. No ROMs, binaries, raw logs, CPU traces, full paths or credentials should be included. Operator must inspect before committing to the private feature branch.

### Run 1

- schema=A063_R2C_ROM_FREE_EVIDENCE_V1
- status=BLOCKED_UNTIL_ALL_GATES_PASS
- replay.status="PASS"
- replay.cases=17
- replay.passed=17
- replay.failed_case_names=[]
- replay.synthetic_banks=5
- replay.synthetic_trace_only=true
- replay.native_bank_provenance_proven=false

**romfree.log** — last 42 diagnostic lines:

```text
test_reject_public_location (test_a063_capture_integrity.IntegrityTests.test_reject_public_location) ... ok
test_source_mutation_detected_at_postflight (test_a063_capture_integrity.IntegrityTests.test_source_mutation_detected_at_postflight) ... ok
Ran 7 tests in 0.046s
test_256_authentic_pairs_and_transition_remain_checkpoint_only (test_a063_smoke_signature_gate.SmokeSummaryTests.test_256_authentic_pairs_and_transition_remain_checkpoint_only) ... ok
test_frame_mismatch_never_promoted (test_a063_smoke_signature_gate.SmokeSummaryTests.test_frame_mismatch_never_promoted) ... ok
test_invalid_entries_rejected (test_a063_smoke_signature_gate.SmokeSummaryTests.test_invalid_entries_rejected) ... ok
test_one_bank_is_inconclusive (test_a063_smoke_signature_gate.SmokeSummaryTests.test_one_bank_is_inconclusive) ... ok
test_too_short_smoke_is_inconclusive (test_a063_smoke_signature_gate.SmokeSummaryTests.test_too_short_smoke_is_inconclusive) ... ok
Ran 5 tests in 0.000s
test_32bit_sign_extension_never_promoted_to_byte (test_a063_adversarial.A063AdversarialTests.test_32bit_sign_extension_never_promoted_to_byte) ... ok
test_64bit_sign_extension_remains_blocked (test_a063_adversarial.A063AdversarialTests.test_64bit_sign_extension_remains_blocked) ... ok
test_duplicate_signature_field_rejected (test_a063_adversarial.A063AdversarialTests.test_duplicate_signature_field_rejected) ... ok
test_truncated_signature_does_not_shift_remaining_rows (test_a063_adversarial.A063AdversarialTests.test_truncated_signature_does_not_shift_remaining_rows) ... ok
test_word_dword_and_cpu_argument_displacement_are_rejected (test_a063_adversarial.A063AdversarialTests.test_word_dword_and_cpu_argument_displacement_are_rejected) ... ok
Ran 5 tests in 0.002s
test_absent_duplicate_invalid_out_of_range_or_orphaned (test_a063_oracle.NativeOracleTests.test_absent_duplicate_invalid_out_of_range_or_orphaned) ... ok
test_byte_sign_extension_never_accepted (test_a063_oracle.NativeOracleTests.test_byte_sign_extension_never_accepted) ... ok
test_corrupt_bank_sequence_fails (test_a063_oracle.NativeOracleTests.test_corrupt_bank_sequence_fails) ... ok
test_exact_per_instruction_bank_agreement_no_full_claim (test_a063_oracle.NativeOracleTests.test_exact_per_instruction_bank_agreement_no_full_claim) ... ok
test_impossible_transition_count_rejected (test_a063_oracle.NativeOracleTests.test_impossible_transition_count_rejected) ... ok
test_insufficient_coverage_or_transition_is_inconclusive (test_a063_oracle.NativeOracleTests.test_insufficient_coverage_or_transition_is_inconclusive) ... ok
test_invalid_native_samples_never_pass (test_a063_oracle.NativeOracleTests.test_invalid_native_samples_never_pass) ... ok
test_legacy_stays_eleven_args (test_a063_oracle.NativeOracleTests.test_legacy_stays_eleven_args) ... ok
test_mismatch_rejected_even_single_instruction (test_a063_oracle.NativeOracleTests.test_mismatch_rejected_even_single_instruction) ... ok
test_one_action_twelve_args_no_mask (test_a063_oracle.NativeOracleTests.test_one_action_twelve_args_no_mask) ... ok
test_reset_disqualifies_transition (test_a063_oracle.NativeOracleTests.test_reset_disqualifies_transition) ... ok
Ran 11 tests in 0.003s
test_patch_applies_to_expected_0289_source_shapes (test_a063_mame_patch.PatchTests.test_patch_applies_to_expected_0289_source_shapes) ... ok
test_patch_does_not_rewrite_bank_switch_handler (test_a063_mame_patch.PatchTests.test_patch_does_not_rewrite_bank_switch_handler) ... ok
Ran 2 tests in 0.007s
test_five_distinct_synthetic_banks (test_a063_oracle_replay.R2BReplayTests.test_five_distinct_synthetic_banks) ... ok
test_fourteen_adversarial_scenarios (test_a063_oracle_replay.R2BReplayTests.test_fourteen_adversarial_scenarios) ... ok
test_repeated_pcs_do_not_shift_instruction_alignment (test_a063_oracle_replay.R2BReplayTests.test_repeated_pcs_do_not_shift_instruction_alignment) ... ok
Ran 3 tests in 0.092s
test_complete_synthetic_window_passes_both_real_parsers (test_a063_oracle_pipeline.R2ToOracleIntegration.test_complete_synthetic_window_passes_both_real_parsers) ... ok
test_malformed_duplicate_cpu_prestates_not_emitted (test_a063_oracle_pipeline.R2ToOracleIntegration.test_malformed_duplicate_cpu_prestates_not_emitted) ... ok
test_orphan_live_bank_marker_rejected (test_a063_oracle_pipeline.R2ToOracleIntegration.test_orphan_live_bank_marker_rejected) ... ok
test_split_signature_rejected_by_bank_parser (test_a063_oracle_pipeline.R2ToOracleIntegration.test_split_signature_rejected_by_bank_parser) ... ok
test_wrong_cpu_value_aligned_to_old_snapshot_rejected (test_a063_oracle_pipeline.R2ToOracleIntegration.test_wrong_cpu_value_aligned_to_old_snapshot_rejected) ... ok
Ran 5 tests in 0.057s
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3
A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED
```

**mame-build.log** — last 42 diagnostic lines:

```text
../../../../../src/emu/output.cpp:75:19: warning: member ‘output_manager::output_proxy::m_local_value’ is used uninitialized [-Wuninitialized]
../../../../../src/emu/schedule.cpp:534:26: warning: ‘void device_scheduler::timer_set(const attotime&, timer_expired_delegate, s32)’ is deprecated: timer_set is deprecated; please avoid anonymous timers. Use an allocated emu_timer instead. [-Wdeprec
../../../../../src/osd/modules/netdev/taptun.cpp:123:16: warning: ‘char* strncpy(char*, const char*, size_t)’ output may be truncated copying 10 bytes from a string of length 15 [-Wstringop-truncation]
../../../../../src/osd/modules/netdev/taptun.cpp:123:16: warning: ‘char* strncpy(char*, const char*, size_t)’ output may be truncated copying 10 bytes from a string of length 15 [-Wstringop-truncation]
../../../../../src/lib/util/cdrom.cpp:1786:14: warning: ignoring return value of ‘size_t fread(void*, size_t, size_t, FILE*)’ declared with attribute ‘warn_unused_result’ [-Wunused-result]
../../../../../src/lib/util/cdrom.cpp:1805:14: warning: ignoring return value of ‘size_t fread(void*, size_t, size_t, FILE*)’ declared with attribute ‘warn_unused_result’ [-Wunused-result]
../../../../../src/lib/util/cdrom.cpp:1824:14: warning: ignoring return value of ‘size_t fread(void*, size_t, size_t, FILE*)’ declared with attribute ‘warn_unused_result’ [-Wunused-result]
../../../../../src/lib/util/cdrom.cpp:1869:14: warning: ignoring return value of ‘size_t fread(void*, size_t, size_t, FILE*)’ declared with attribute ‘warn_unused_result’ [-Wunused-result]
../../../../../src/lib/util/cdrom.cpp:1892:22: warning: ignoring return value of ‘size_t fread(void*, size_t, size_t, FILE*)’ declared with attribute ‘warn_unused_result’ [-Wunused-result]
../../../../../src/lib/util/cdrom.cpp:1905:30: warning: ignoring return value of ‘size_t fread(void*, size_t, size_t, FILE*)’ declared with attribute ‘warn_unused_result’ [-Wunused-result]
../../../../../src/lib/util/cdrom.cpp:1906:30: warning: ignoring return value of ‘size_t fread(void*, size_t, size_t, FILE*)’ declared with attribute ‘warn_unused_result’ [-Wunused-result]
/usr/include/c++/13/bits/stl_algobase.h:931:18: warning: ‘void* __builtin_memset(void*, int, long unsigned int)’ pointer overflow between offset 0 and size [-9223372036854775807, -1] [-Warray-bounds=]
../../../../../3rdparty/softfloat3/source/extF80_roundToInt.c:98:13: warning: this statement may fall through [-Wimplicit-fallthrough=]
../../../../../3rdparty/softfloat3/source/f128_roundToInt.c:117:17: warning: this statement may fall through [-Wimplicit-fallthrough=]
../../../../../3rdparty/softfloat3/source/f16_roundToInt.c:65:13: warning: this statement may fall through [-Wimplicit-fallthrough=]
../../../../../3rdparty/softfloat3/source/f32_roundToInt.c:65:13: warning: this statement may fall through [-Wimplicit-fallthrough=]
../../../../../3rdparty/softfloat3/source/f64_roundToInt.c:65:13: warning: this statement may fall through [-Wimplicit-fallthrough=]
../../../../../3rdparty/ymfm/src/ymfm_fm.ipp:1525:29: warning: array subscript 2 is above array bounds of ‘uint8_t [2]’ {aka ‘unsigned char [2]’} [-Warray-bounds=]
../../../../../3rdparty/ymfm/src/ymfm_fm.ipp:1525:29: warning: array subscript 2 is above array bounds of ‘uint8_t [2]’ {aka ‘unsigned char [2]’} [-Warray-bounds=]
../../../../../3rdparty/ymfm/src/ymfm_fm.ipp:1525:29: warning: array subscript 2 is above array bounds of ‘uint8_t [2]’ {aka ‘unsigned char [2]’} [-Warray-bounds=]
../../../../../3rdparty/lsqlite3/lsqlite3.c:1320:16: warning: unused variable ‘n’ [-Wunused-variable]
```

**patch-check.log** — last 42 diagnostic lines:

```text
A063_PATCH=PREVIOUS_INTERRUPTED_BUILD_RESUME
```

**patch-apply.log** — last 42 diagnostic lines:

```text
A063_PATCH=VERIFIED_EXACT_APPLIED_NOT_COMPILED
```


### Run 2

- schema=A063_R2C_ROM_FREE_EVIDENCE_V1
- status=BLOCKED_UNTIL_ALL_GATES_PASS
- replay.status="PASS"
- replay.cases=17
- replay.passed=17
- replay.failed_case_names=[]
- replay.synthetic_banks=5
- replay.synthetic_trace_only=true
- replay.native_bank_provenance_proven=false

**romfree.log** — last 42 diagnostic lines:

```text
test_reject_public_location (test_a063_capture_integrity.IntegrityTests.test_reject_public_location) ... ok
test_source_mutation_detected_at_postflight (test_a063_capture_integrity.IntegrityTests.test_source_mutation_detected_at_postflight) ... ok
Ran 7 tests in 0.507s
test_256_authentic_pairs_and_transition_remain_checkpoint_only (test_a063_smoke_signature_gate.SmokeSummaryTests.test_256_authentic_pairs_and_transition_remain_checkpoint_only) ... ok
test_frame_mismatch_never_promoted (test_a063_smoke_signature_gate.SmokeSummaryTests.test_frame_mismatch_never_promoted) ... ok
test_invalid_entries_rejected (test_a063_smoke_signature_gate.SmokeSummaryTests.test_invalid_entries_rejected) ... ok
test_one_bank_is_inconclusive (test_a063_smoke_signature_gate.SmokeSummaryTests.test_one_bank_is_inconclusive) ... ok
test_too_short_smoke_is_inconclusive (test_a063_smoke_signature_gate.SmokeSummaryTests.test_too_short_smoke_is_inconclusive) ... ok
Ran 5 tests in 0.001s
test_32bit_sign_extension_never_promoted_to_byte (test_a063_adversarial.A063AdversarialTests.test_32bit_sign_extension_never_promoted_to_byte) ... ok
test_64bit_sign_extension_remains_blocked (test_a063_adversarial.A063AdversarialTests.test_64bit_sign_extension_remains_blocked) ... ok
test_duplicate_signature_field_rejected (test_a063_adversarial.A063AdversarialTests.test_duplicate_signature_field_rejected) ... ok
test_truncated_signature_does_not_shift_remaining_rows (test_a063_adversarial.A063AdversarialTests.test_truncated_signature_does_not_shift_remaining_rows) ... ok
test_word_dword_and_cpu_argument_displacement_are_rejected (test_a063_adversarial.A063AdversarialTests.test_word_dword_and_cpu_argument_displacement_are_rejected) ... ok
Ran 5 tests in 0.002s
test_absent_duplicate_invalid_out_of_range_or_orphaned (test_a063_oracle.NativeOracleTests.test_absent_duplicate_invalid_out_of_range_or_orphaned) ... ok
test_byte_sign_extension_never_accepted (test_a063_oracle.NativeOracleTests.test_byte_sign_extension_never_accepted) ... ok
test_corrupt_bank_sequence_fails (test_a063_oracle.NativeOracleTests.test_corrupt_bank_sequence_fails) ... ok
test_exact_per_instruction_bank_agreement_no_full_claim (test_a063_oracle.NativeOracleTests.test_exact_per_instruction_bank_agreement_no_full_claim) ... ok
test_impossible_transition_count_rejected (test_a063_oracle.NativeOracleTests.test_impossible_transition_count_rejected) ... ok
test_insufficient_coverage_or_transition_is_inconclusive (test_a063_oracle.NativeOracleTests.test_insufficient_coverage_or_transition_is_inconclusive) ... ok
test_invalid_native_samples_never_pass (test_a063_oracle.NativeOracleTests.test_invalid_native_samples_never_pass) ... ok
test_legacy_stays_eleven_args (test_a063_oracle.NativeOracleTests.test_legacy_stays_eleven_args) ... ok
test_mismatch_rejected_even_single_instruction (test_a063_oracle.NativeOracleTests.test_mismatch_rejected_even_single_instruction) ... ok
test_one_action_twelve_args_no_mask (test_a063_oracle.NativeOracleTests.test_one_action_twelve_args_no_mask) ... ok
test_reset_disqualifies_transition (test_a063_oracle.NativeOracleTests.test_reset_disqualifies_transition) ... ok
Ran 11 tests in 0.003s
test_patch_applies_to_expected_0289_source_shapes (test_a063_mame_patch.PatchTests.test_patch_applies_to_expected_0289_source_shapes) ... ok
test_patch_does_not_rewrite_bank_switch_handler (test_a063_mame_patch.PatchTests.test_patch_does_not_rewrite_bank_switch_handler) ... ok
Ran 2 tests in 0.006s
test_five_distinct_synthetic_banks (test_a063_oracle_replay.R2BReplayTests.test_five_distinct_synthetic_banks) ... ok
test_fourteen_adversarial_scenarios (test_a063_oracle_replay.R2BReplayTests.test_fourteen_adversarial_scenarios) ... ok
test_repeated_pcs_do_not_shift_instruction_alignment (test_a063_oracle_replay.R2BReplayTests.test_repeated_pcs_do_not_shift_instruction_alignment) ... ok
Ran 3 tests in 0.124s
test_complete_synthetic_window_passes_both_real_parsers (test_a063_oracle_pipeline.R2ToOracleIntegration.test_complete_synthetic_window_passes_both_real_parsers) ... ok
test_malformed_duplicate_cpu_prestates_not_emitted (test_a063_oracle_pipeline.R2ToOracleIntegration.test_malformed_duplicate_cpu_prestates_not_emitted) ... ok
test_orphan_live_bank_marker_rejected (test_a063_oracle_pipeline.R2ToOracleIntegration.test_orphan_live_bank_marker_rejected) ... ok
test_split_signature_rejected_by_bank_parser (test_a063_oracle_pipeline.R2ToOracleIntegration.test_split_signature_rejected_by_bank_parser) ... ok
test_wrong_cpu_value_aligned_to_old_snapshot_rejected (test_a063_oracle_pipeline.R2ToOracleIntegration.test_wrong_cpu_value_aligned_to_old_snapshot_rejected) ... ok
Ran 5 tests in 0.057s
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3
A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED
```

**mame-build.log** — last 42 diagnostic lines:

```text
[no error/status markers in selected lines]
```

**patch-check.log** — last 42 diagnostic lines:

```text
A063_PATCH=PREVIOUS_INTERRUPTED_BUILD_RESUME
```

**patch-apply.log** — last 42 diagnostic lines:

```text
A063_PATCH=VERIFIED_EXACT_APPLIED_NOT_COMPILED
```

