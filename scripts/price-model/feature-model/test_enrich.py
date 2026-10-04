import unittest
import numpy as np
from enrich import station_features,peer_features


class CausalFeatures(unittest.TestCase):
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


if __name__=='__main__':unittest.main()
