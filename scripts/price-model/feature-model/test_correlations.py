import unittest
import numpy as np
import pandas as pd
from correlation_study import corr,matrix


class CorrelationContracts(unittest.TestCase):
    def test_positive_lag_means_row_precedes_column(self):
        rng=np.random.default_rng(9);leader=rng.normal(size=100);follower=np.r_[np.full(6,np.nan),leader[:-6]]
        m=matrix(pd.DataFrame({'leader':leader,'follower':follower}),6)
        self.assertAlmostEqual(m.loc['leader','follower'],1)
        self.assertLess(abs(m.loc['follower','leader']),.3)

    def test_missing_and_constant_are_not_zero_correlations(self):
        self.assertTrue(np.isnan(corr(np.ones(30),np.arange(30))))
        self.assertTrue(np.isnan(corr(np.r_[1.,2.,np.full(28,np.nan)],np.arange(30))))

    def test_no_rows_created_by_pairwise_missing(self):
        x=np.arange(30,dtype=float);y=x.copy();y[::2]=np.nan
        self.assertAlmostEqual(corr(x,y),1)
        self.assertTrue(np.isnan(corr(x,y,minimum=16)))


if __name__=='__main__':unittest.main()
