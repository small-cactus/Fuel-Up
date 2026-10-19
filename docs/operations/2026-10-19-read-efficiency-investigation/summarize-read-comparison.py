import json, pathlib, statistics, datetime
p=pathlib.Path('/tmp/fuel-dedup')
def snapshot(name):return json.loads((p/name).read_text())['data']['rows'][0]['reads']
def diff(a,b):
 out={}
 for label,ref in [('metadata','fuel_station_metadata_needed'),('publication','fuel_station_batch')]:
  va=next(v for v in a['statements'] if v['fuel_references']==[ref]);vb=next(v for v in b['statements'] if v['fuel_references']==[ref])
  d={k:vb[k]-va[k] for k in ['calls','shared_blks_read','shared_blks_hit','total_exec_time','wal_bytes']}
  d['readMiB']=d['shared_blks_read']/128;d['executionSeconds']=d['total_exec_time']/1000
  out[label]=d
 return out
baseline=diff(snapshot('read-costs-baseline.json'),snapshot('read-baseline-sweep-complete.json'))
after=diff(snapshot('read-live-baseline.json'),snapshot('read-live-complete-counters.json'))
comparison={}
for label in baseline:
 old,new=baseline[label],after[label]
 comparison[label]={'before':old,'after':new,'readReductionPercent':100*(1-new['shared_blks_read']/old['shared_blks_read']),'executionTimeReductionPercent':100*(1-new['total_exec_time']/old['total_exec_time'])}
before_reads=sum(v['shared_blks_read'] for v in baseline.values());after_reads=sum(v['shared_blks_read'] for v in after.values())
comparison['combined']={'beforeReadMiB':before_reads/128,'afterReadMiB':after_reads/128,'readReductionPercent':100*(1-after_reads/before_reads),'beforeExecutionSeconds':sum(v['executionSeconds'] for v in baseline.values()),'afterExecutionSeconds':sum(v['executionSeconds'] for v in after.values())}
s=json.loads((p/'read-live-progress.json').read_text())[-1];v=s['verification'];r=v['run']
comparison['verification']={'runId':r['id'],'slotAt':r['slot_at'],'completedAt':r['completed_at'],'publishedAt':s['cache']['published_at'],'attempts':v['attempts'],'publishedBatches':v['published_batches'],'summarizedBatches':v['summarized_batches'],'observedStations':v['observed_stations'],'stationRowsChanged':v['station_rows_changed'],'stationUpdateReductionAgainstRewritingEveryStationPercent':100*(1-v['station_rows_changed']/v['observed_stations']),'regional':v['regional']}
integrity=json.loads((p/'read-final-integrity.json').read_text())['data']['rows'][0]['integrity']
comparison['verification']['publicationTimeoutsRecovered']=sum(e['count'] for e in integrity['events'] if e['code']=='SERVING_DEFERRED_CLIENT_TIMEOUT')
series=json.loads((p/'pressure-read-live-series.json').read_text());valid=[x for x in series if x['countersAdvanced'] and not x['rebooted'] and datetime.datetime.fromisoformat(x['sampledAt'].replace('Z','+00:00')) <= datetime.datetime.fromisoformat(r['completed_at'])]
comparison['resources']={'samplePolicy':'Only advancing samples ending before collection completed; post-run archive audit excluded','validSamples':len(valid),'ioWaitPercent':{'min':min(x['cpuIoWaitPercent'] for x in valid),'median':statistics.median(x['cpuIoWaitPercent'] for x in valid),'max':max(x['cpuIoWaitPercent'] for x in valid)},'swapInBytes':sum(x['swapInBytesAt4KiB'] for x in valid),'swapOutBytes':sum(x['swapOutBytesAt4KiB'] for x in valid),'oomKills':sum(x['oomKills'] or 0 for x in valid),'sampledElapsedSeconds':sum(x['elapsedSeconds'] for x in valid),'diskTotals':{dev:{metric:sum(x['disks'].get(dev,{}).get(metric) or 0 for x in valid) for metric in ['read_bytes','written_bytes','io_time_seconds']} for dev in sorted(set().union(*(x['disks'].keys() for x in valid)))},'lastCpuModes':valid[-1].get('cpuModePercent'),'lastMemoryBytes':valid[-1]['memoryBytes']}
comparison['limitations']=['Sequential complete live sweeps with fresh provider responses; quote changes, cache warmth and background maintenance differ.','PostgreSQL block reads are not total physical disk IO.','Pressure samples are not a matched complete before/after hardware benchmark; swapping persisted.','The earlier normal scheduled sweep used write deduplication, before the compact-read deployment. No subsequent scheduled compact-read sweep is claimed here.','Fixed-inventory provider observations are not verified pump truth.']
(p/'read-comparison.json').write_text(json.dumps(comparison,indent=2)+'\n');print(json.dumps(comparison,indent=2))
