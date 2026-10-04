import unittest
import json,tempfile,contextlib,io
from pathlib import Path
import numpy as np
from enrich import station_features,peer_features
from enrich import past_windows
from national_context import build as build_context
from hourly_features import query_pairs


class CausalFeatures(unittest.TestCase):
    def test_query_sampling_includes_aging_quotes_and_unknown_outcomes(self):
        p=np.array([3.,3.,3.,3.,3.2,3.2,3.2]);s=np.array([0.,0.,0.,0.,4.,4.,4.]);o=np.arange(7)+.1
        rows=list(query_pairs([0,4],s,o,p,0,period=2))
        self.assertIn((0,2,4),rows)
        self.assertIn((1,6,None),rows)

    def test_history_windows_exclude_current_and_keep_missing(self):
        x=np.array([[1.],[np.nan],[3.],[4.]])
        w=past_windows(x,2)
        np.testing.assert_allclose(w[:,:,0].ravel(),[np.nan,np.nan,1,np.nan],equal_nan=True)
        np.testing.assert_allclose(w[:,:,1].ravel(),[np.nan,1,np.nan,3],equal_nan=True)

    def test_future_station_changes_do_not_affect_past_features(self):
        rng=np.random.default_rng(4)
        p=3+rng.normal(0,.05,(12,14));s=np.broadcast_to(np.arange(12)[:,None],p.shape).copy();o=np.arange(12)+.2
        names,a=station_features(p,s,o)
        p[8:]+=20;s[8:]+=20
        _,b=station_features(p,s,o)
        np.testing.assert_allclose(a[:8],b[:8],equal_nan=True)

    def test_current_peer_not_available(self):
        own=np.ones((12,14))*3
        peers=np.ones((12,4,14))*3.2;s=np.broadcast_to(np.arange(12)[:,None,None],peers.shape).copy();o=np.broadcast_to(np.arange(12)[:,None]+.1,(12,4))
        _,a=peer_features(own,peers,s,o)
        peers[7:]+=1
        _,b=peer_features(own,peers,s,o)
        np.testing.assert_allclose(a[:8],b[:8],equal_nan=True)
        self.assertFalse(np.allclose(a[8:],b[8:],equal_nan=True))

    def test_premium_spread_preserved_and_new_change_visible(self):
        p=np.ones((8,14))*3;p[:,4]=3.6
        s=np.broadcast_to(np.arange(8)[:,None],p.shape);o=np.arange(8)+.1
        names,a=station_features(p,s,o)
        k=names.index('product_4_spread_residual')
        self.assertAlmostEqual(float(a[6,0,k]),0,places=5)
        p[6,4]=3.8
        _,b=station_features(p,s,o)
        self.assertAlmostEqual(float(b[6,0,k]),.2,places=5)

    def test_national_context_uses_all_states_and_only_previous_hours(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'arrays').mkdir()
            metadata={'ids':['a','b','c'],'states':['AA','AA','BB'],'shape':[6,3,2],'start_hour':0,'manifest_sha256':'test'}
            (root/'arrays/metadata.json').write_text(json.dumps(metadata))
            (root/'geography.json').write_text(json.dumps([{'station_id':i,'latitude':30+k,'longitude':-90+k} for k,i in enumerate(metadata['ids'])]))
            p=np.ones((6,3,2))*3;p[:,2]=4
            s=np.broadcast_to(np.arange(6)[:,None,None],p.shape).copy();o=np.broadcast_to(np.arange(6)[:,None]+.2,(6,3))
            for name,value in [('prices',p),('sources',s),('observed',o)]:np.save(root/'arrays'/f'{name}.npy',value)
            with contextlib.redirect_stdout(io.StringIO()):build_context(root,root/'one')
            a=np.load(root/'one/national-context.npy')
            self.assertEqual(a.shape,(6,2,2,12));self.assertEqual(a[3,0,1,3],4)
            p[3:,2]=9;np.save(root/'arrays/prices.npy',p)
            with contextlib.redirect_stdout(io.StringIO()):build_context(root,root/'two')
            b=np.load(root/'two/national-context.npy')
            np.testing.assert_allclose(a[:4],b[:4],equal_nan=True)
            self.assertEqual(b[4,0,1,3],9)


if __name__=='__main__':unittest.main()
