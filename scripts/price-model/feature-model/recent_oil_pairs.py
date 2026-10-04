"""Exact date-pair illustration, without multiplying daily oil observations by stations."""
import argparse,json
from pathlib import Path
import numpy as np
import pandas as pd
from correlation_study import corr,save_matrix


def main(root,out):
    m=json.loads((root/'arrays/metadata.json').read_text())
    change=pd.read_csv(out/'state-hourly-changes.csv');count=pd.read_csv(out/'state-paired-counts.csv')
    # Only observed adjacent-hour pairs; missing collection is never a zero move.
    numerator=(change*count).sum(axis=1,min_count=1);denominator=count.where(change.notna()).sum(axis=1,min_count=1)
    hourly=numerator/denominator
    dates=pd.to_datetime(m['base_epoch']+(m['start_hour']+np.arange(1,len(hourly)+1))*3600,unit='s',utc=True).tz_localize(None)
    daily=pd.DataFrame({'mean_hourly_move':hourly.to_numpy(),'date':dates.floor('D')}).groupby('date').agg(gas_mean_hourly_move=('mean_hourly_move','mean'),observed_hours=('mean_hourly_move','count'))
    output=[];summary=[]
    for name in ['DCOILWTICO','DCOILBRENTEU']:
        oil=pd.read_csv(root/'oil'/(name+'.csv'),index_col=0,parse_dates=True)[name];oil=pd.to_numeric(oil,errors='coerce').dropna()
        calendar=oil.reindex(pd.date_range(oil.index.min(),daily.index.max())).ffill(limit=7)
        for lag in [0,1,3,7,8,14,21,28,30,42,60]:
            records=[]
            for date,row in daily.iterrows():
                at=date-pd.Timedelta(days=lag)
                # Record actual source date, so carry-forward is transparent.
                available=oil.loc[:at];stamp=available.index[-1] if len(available) else pd.NaT
                prior=at-pd.Timedelta(days=1)
                a=calendar.get(at,np.nan);b=calendar.get(prior,np.nan)
                records.append({'series':name,'lag_days':lag,'gas_date':str(date.date()),'gas_mean_hourly_move':row.gas_mean_hourly_move,'observed_hours':int(row.observed_hours),'oil_target_date':str(at.date()),'oil_actual_source_date':str(stamp.date()),'oil_level':a,'oil_daily_change':a-b})
            output.extend(records);f=pd.DataFrame(records);ok=f.oil_daily_change.notna()&f.gas_mean_hourly_move.notna()
            summary.append({'series':name,'lag_days':lag,'distinct_date_pairs':int(ok.sum()),'r':corr(f.oil_daily_change.to_numpy(),f.gas_mean_hourly_move.to_numpy(),minimum=3)})
    pd.DataFrame(output).to_csv(out/'recent-oil-date-pairs.csv',index=False);f=pd.DataFrame(summary);f.to_csv(out/'recent-oil-correlations.csv',index=False)
    save_matrix(f.pivot(index='series',columns='lag_days',values='r'),out,'recent-oil-lag-matrix','Exploratory only: 4 dates, incomplete days, daily crude changes')
    (out/'recent-oil-limitations.json').write_text(json.dumps({'method':'Matched-station hourly changes averaged within observed UTC day, paired with daily oil changes at each lag. Not a complete daily gasoline return.','distinct_dates':len(daily),'days':daily.reset_index().astype({'date':str}).to_dict('records'),'warning':'A numerical correlation can be computed at 30 days. With only four dates, incomplete days, shared daily oil values, and many candidate lags, it is not reliable lag identification. Neither the 141660 stations nor hourly replication adds independent oil-change dates.','current_oil':'Carry-forward source dates disclosed in CSV; no claim of live intraday oil prices.'},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('out',type=Path);a=p.parse_args();main(a.root,a.out)
