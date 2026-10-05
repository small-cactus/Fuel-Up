# Persistent network-fault toggle

The Dev toggle writes a native UserDefaults boolean synchronously through the
existing bridge. The JS transport reads it at initialization, before accepting
requests. The native research gate reads the same preference when initialized.
Only the fault-injection boundary knows this setting; service monitoring,
timeouts, retries and the overlay remain unchanged. The Dev description now
says the setting stays on until turned off.

Verified on the iPhone 17 Pro Max iOS 26.5 simulator with a rebuilt native app:

1. Enabled faults through the actual Dev toggle handler; confirmed native saved
   value and JS transport value were true.
2. Used Argent restart-app to terminate the process and relaunch it.
3. Without enabling faults again, both native preference and JS gate were true.
   All six real service checks timed out at their ordinary deadlines. The Dev
   screen's Network Faults control had accessibility value 1.
4. Disabled faults and terminated/relaunched again. Both values remained false;
   real service checks responded successfully. Left simulator faults disabled.

Runtime snapshots are in reopened-on.json and reopened-off.json. This verifies
process restart, not just a JS reload. No reinstall occurred between toggle and
restart assertions.

Validation: 20 focused network/overlay tests and 160 normal tests passed;
standalone Swift typecheck, Debug simulator build, and signed Release device
build passed. Installed in place on iPhone 18 Pro Max
00008160-001E206E02A0000A via CLI, preserving phone data. Phone installation is
separate from the simulator restart QA.
