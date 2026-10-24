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
Ran 7 tests in 0.048s
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
Ran 2 tests in 0.009s
test_five_distinct_synthetic_banks (test_a063_oracle_replay.R2BReplayTests.test_five_distinct_synthetic_banks) ... ok
test_fourteen_adversarial_scenarios (test_a063_oracle_replay.R2BReplayTests.test_fourteen_adversarial_scenarios) ... ok
test_repeated_pcs_do_not_shift_instruction_alignment (test_a063_oracle_replay.R2BReplayTests.test_repeated_pcs_do_not_shift_instruction_alignment) ... ok
Ran 3 tests in 0.094s
test_complete_synthetic_window_passes_both_real_parsers (test_a063_oracle_pipeline.R2ToOracleIntegration.test_complete_synthetic_window_passes_both_real_parsers) ... ok
test_malformed_duplicate_cpu_prestates_not_emitted (test_a063_oracle_pipeline.R2ToOracleIntegration.test_malformed_duplicate_cpu_prestates_not_emitted) ... ok
test_orphan_live_bank_marker_rejected (test_a063_oracle_pipeline.R2ToOracleIntegration.test_orphan_live_bank_marker_rejected) ... ok
test_split_signature_rejected_by_bank_parser (test_a063_oracle_pipeline.R2ToOracleIntegration.test_split_signature_rejected_by_bank_parser) ... ok
test_wrong_cpu_value_aligned_to_old_snapshot_rejected (test_a063_oracle_pipeline.R2ToOracleIntegration.test_wrong_cpu_value_aligned_to_old_snapshot_rejected) ... ok
Ran 5 tests in 0.053s
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3
A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED
```

**mame-build.log** — last 42 diagnostic lines:

```text
../../../../../3rdparty/flac/src/libFLAC/stream_encoder.c:1765:51: warning: cast from function call of type ‘double’ to non-matching type ‘int’ [-Wbad-function-cast]
../../../../../3rdparty/flac/src/libFLAC/stream_encoder.c:1786:51: warning: cast from function call of type ‘double’ to non-matching type ‘int’ [-Wbad-function-cast]
../../../../../3rdparty/flac/src/libFLAC/stream_encoder.c:1807:45: warning: cast from function call of type ‘double’ to non-matching type ‘int’ [-Wbad-function-cast]
../../../../../src/emu/debug/debugcmd.cpp:2379:14: warning: ignoring return value of ‘size_t fread(void*, size_t, size_t, FILE*)’ declared with attribute ‘warn_unused_result’ [-Wunused-result]
../../../../../src/lib/formats/wavfile.cpp:245:22: warning: ignoring return value of ‘size_t fread(void*, size_t, size_t, FILE*)’ declared with attribute ‘warn_unused_result’ [-Wunused-result]
{standard input}:6460: Warning: end of file not at end of a line; newline inserted
g++: fatal error: Terminated signal terminated program cc1plus
make[2]: *** [frontend.make:820: ../../../../linux_gcc/obj/x64/Release/src/frontend/mame/luaengine.o] Error 1
make[1]: *** [Makefile:104: frontend] Error 2
```

**patch-check.log** — last 42 diagnostic lines:

```text
A063_PATCH=CHECKED_SOURCE_ONLY_NOT_COMPILED
```

**patch-apply.log** — last 42 diagnostic lines:

```text
A063_PATCH=APPLIED_SOURCE_ONLY_NOT_COMPILED
```


### Run 2

- schema=A063_R2C_ROM_FREE_EVIDENCE_V1
- status=BLOCKED_UNTIL_ALL_GATES_PASS

**romfree.log** — last 42 diagnostic lines:

```text
ok 34 - invalid/native-corrupted CPU samples fail closed, never count fictitious coverage
# fail 0
test_control_value_formula_exhaustively (test_r3_bank_inventory.BankInventoryTests.test_control_value_formula_exhaustively) ... ok
test_five_authentic_bank_offsets_preserve_gg4_fixed_segment (test_r3_bank_inventory.BankInventoryTests.test_five_authentic_bank_offsets_preserve_gg4_fixed_segment) ... ok
test_images_only_prepares_authenticated_banks_without_prior_r2 (test_r3_bank_inventory.BankInventoryTests.test_images_only_prepares_authenticated_banks_without_prior_r2) ... ok
test_incomplete_malformed_and_multiple_probe_reports_reject (test_r3_bank_inventory.BankInventoryTests.test_incomplete_malformed_and_multiple_probe_reports_reject) ... ok
test_native_samples_are_only_frame_and_write_tap_observations (test_r3_bank_inventory.BankInventoryTests.test_native_samples_are_only_frame_and_write_tap_observations) ... ok
test_pc_coverage_is_not_bank_entry_attribution (test_r3_bank_inventory.BankInventoryTests.test_pc_coverage_is_not_bank_entry_attribution) ... ok
test_private_output_is_confined_to_ignored_out_r3 (test_r3_bank_inventory.BankInventoryTests.test_private_output_is_confined_to_ignored_out_r3) ... ok
Ran 7 tests in 0.008s
test_diagnose_foreign_nonbyte_values_remains_blocked (test_r3_bank_provenance.NativeBankSignatures.test_diagnose_foreign_nonbyte_values_remains_blocked) ... ok
test_diagnose_wide_signatures_with_authentic_low_byte_candidate_without_trusting_them (test_r3_bank_provenance.NativeBankSignatures.test_diagnose_wide_signatures_with_authentic_low_byte_candidate_without_trusting_them) ... ok
test_diagnostic_identifies_split_or_unformatted_trace_without_raw_data (test_r3_bank_provenance.NativeBankSignatures.test_diagnostic_identifies_split_or_unformatted_trace_without_raw_data) ... ok
test_duplicate_signature_marker_is_not_allowed_even_with_one_valid_pair (test_r3_bank_provenance.NativeBankSignatures.test_duplicate_signature_marker_is_not_allowed_even_with_one_valid_pair) ... ok
test_missing_discrimination_fails_closed (test_r3_bank_provenance.NativeBankSignatures.test_missing_discrimination_fails_closed) ... ok
test_native_debugger_minimum_width_and_optional_hex_prefix (test_r3_bank_provenance.NativeBankSignatures.test_native_debugger_minimum_width_and_optional_hex_prefix) ... ok
test_no_unverified_transition_is_relabelled_as_selector (test_r3_bank_provenance.NativeBankSignatures.test_no_unverified_transition_is_relabelled_as_selector) ... ok
test_non_byte_signature_is_rejected_and_shape_diagnostic_redacts (test_r3_bank_provenance.NativeBankSignatures.test_non_byte_signature_is_rejected_and_shape_diagnostic_redacts) ... ok
test_same_pc_but_different_cpu_register_or_trace_line_fails_closed (test_r3_bank_provenance.NativeBankSignatures.test_same_pc_but_different_cpu_register_or_trace_line_fails_closed) ... ok
test_shape_diagnosis_does_not_shift_alignment_after_malformed_pair (test_r3_bank_provenance.NativeBankSignatures.test_shape_diagnosis_does_not_shift_alignment_after_malformed_pair) ... ok
test_stale_missing_ambiguous_and_foreign_native_signatures_fail (test_r3_bank_provenance.NativeBankSignatures.test_stale_missing_ambiguous_and_foreign_native_signatures_fail) ... ok
test_stock_debugger_trace_and_backup_are_wired_without_actions (test_r3_bank_provenance.NativeBankSignatures.test_stock_debugger_trace_and_backup_are_wired_without_actions) ... ok
test_trace_one_to_one_alignment_and_bank_id (test_r3_bank_provenance.NativeBankSignatures.test_trace_one_to_one_alignment_and_bank_id) ... ok
test_transition_matches_rom_attested_bankswitch_instruction (test_r3_bank_provenance.NativeBankSignatures.test_transition_matches_rom_attested_bankswitch_instruction) ... ok
test_two_offsets_cover_all_five_banks (test_r3_bank_provenance.NativeBankSignatures.test_two_offsets_cover_all_five_banks) ... ok
Ran 15 tests in 0.044s
test_exact_one_line_trace_action_eleven_arguments (test_a063_trace_contract.TraceContractTests.test_exact_one_line_trace_action_eleven_arguments) ... ok
test_invalid_offsets_reject_before_emulator (test_a063_trace_contract.TraceContractTests.test_invalid_offsets_reject_before_emulator) ... ok
test_manifest_records_environment_but_never_attests_native (test_a063_trace_contract.TraceContractTests.test_manifest_records_environment_but_never_attests_native) ... ok
test_manifest_refuses_public_or_unscoped_location (test_a063_trace_contract.TraceContractTests.test_manifest_refuses_public_or_unscoped_location) ... ok
test_miniprobe_does_not_require_prior_r2 (test_a063_trace_contract.TraceContractTests.test_miniprobe_does_not_require_prior_r2) ... ok
test_miniprobe_preserves_existing_native_evidence_by_design (test_a063_trace_contract.TraceContractTests.test_miniprobe_preserves_existing_native_evidence_by_design) ... ok
test_r2_parsers_allow_only_exact_private_smoke_output (test_a063_trace_contract.TraceContractTests.test_r2_parsers_allow_only_exact_private_smoke_output) ... FAIL
test_template_tampering_detected (test_a063_trace_contract.TraceContractTests.test_template_tampering_detected) ... ok
test_triage_17135_aligned_overflow_never_passes (test_a063_trace_contract.TraceContractTests.test_triage_17135_aligned_overflow_never_passes) ... ok
test_triage_even_all_byte_values_only_ready_for_private_parser (test_a063_trace_contract.TraceContractTests.test_triage_even_all_byte_values_only_ready_for_private_parser) ... ok
test_triage_requires_alignment_and_rejects_impossible_counts (test_a063_trace_contract.TraceContractTests.test_triage_requires_alignment_and_rejects_impossible_counts) ... ok
FAIL: test_r2_parsers_allow_only_exact_private_smoke_output (test_a063_trace_contract.TraceContractTests.test_r2_parsers_allow_only_exact_private_smoke_output)
Traceback (most recent call last):
  File "$REPO/tests/test_a063_trace_contract.py", line 127, in test_r2_parsers_allow_only_exact_private_smoke_output
Ran 11 tests in 0.011s
FAILED (failures=1)
```

