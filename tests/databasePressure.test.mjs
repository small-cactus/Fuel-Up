import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMetrics, summarizePressure } from '../scripts/operations/databasePressure.mjs';
const metrics = (boot, swap, cpu, io) => parseMetrics(`node_boot_time_seconds ${boot}
node_vmstat_pswpin ${swap}
node_memory_MemTotal_bytes 400000000
node_cpu_seconds_total{cpu="0",mode="user"} ${cpu}
node_cpu_seconds_total{cpu="0",mode="iowait"} ${io}
node_cpu_seconds_total{cpu="0",mode="guest"} ${cpu}
node_disk_read_bytes_total{device="nvme0n1"} ${swap * 10}`);
test('reports interval activity without double-counting guest CPU; absent counters remain unknown', () => {
 const r = summarizePressure(metrics(1, 10, 20, 10), metrics(1, 20, 50, 20), 30);
 assert.equal(r.swapInBytesAt4KiB, 40960);
 assert.equal(r.swapOutPages, null);
 assert.equal(r.oomKills, null);
 assert.equal(r.cpuIoWaitPercent, 25);
 assert.equal(r.disks.nvme0n1.read_bytes, 100);
});
test('reboots invalidate deltas even when a new counter exceeds its old value', () => {
 const r = summarizePressure(metrics(1, 10, 20, 10), metrics(2, 100, 50, 20), 30);
 assert.equal(r.rebooted, true);
 assert.equal(r.swapInPages, null);
 assert.equal(r.cpuIoWaitPercent, null);
 assert.equal(r.disks.nvme0n1.read_bytes, null);
});

test('cached samples cannot be mistaken for no swap activity', () => {
 const sample = metrics(1, 10, 20, 10);
 const r = summarizePressure(sample, sample, 30);
 assert.equal(r.countersAdvanced, false);
 assert.equal(r.swapInPages, null);
 assert.equal(r.disks.nvme0n1.read_bytes, null);
});
