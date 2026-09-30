import importlib.util, unittest
from datetime import datetime, timezone
spec=importlib.util.spec_from_file_location('geographic','scripts/national-prices/reconcileGeographicCatalog.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class CoverageTests(unittest.TestCase):
    def fixture(self):
        now=datetime.now(timezone.utc).isoformat()
        boundary={'source':'test','data':{'features':[{'properties':{'STUSAB':'TX'},'geometry':{'type':'Polygon','coordinates':[[[-100.1,30.9],[-99.9,30.9],[-99.9,31.1],[-100.1,31.1],[-100.1,30.9]]]}}]}}
        stations=[{'id':str(i),'latitude':31,'longitude':-100} for i in (1,2)]
        state={'observedAt':now,'task':{'kind':'states'},'scopes':[{'state':'TX','scopeMatches':True,'reportedCount':1,'stations':stations[:1]}]}
        nearby={'observedAt':now,'executionRegion':'us-east-1','task':{'kind':'nearby'},'scopes':[{'state':'TX','fullResponse':True,'reportedCount':2,'requestedCenter':{'latitude':31,'longitude':-100},'stations':stations}]}
        return [state,nearby],{'regions':[],'gaps':[{'code':'TX'}]},boundary,{'ids':['1'],'seedObservedAt':now}
    def test_real_returned_ids_and_disagreeing_provider_total_are_both_preserved(self):
        catalog,evidence=module.certify(*self.fixture())
        self.assertEqual(catalog['regions'][0]['ids'],['1','2'])
        self.assertEqual(evidence['providerReportedCount'],1)
        self.assertEqual(evidence['countDiscrepancy'],1)
    def test_partial_response_uncovered_area_and_omitted_known_id_cannot_pass(self):
        for issue in ('partial','gap','missing'):
            args=list(self.fixture())
            if issue=='partial':args[0][1]['scopes'][0]['fullResponse']=False
            if issue=='gap':args[2]['data']['features'][0]['geometry']['coordinates'][0][2]=[-99,32]
            if issue=='missing':args[3]['ids'].append('3')
            with self.assertRaises(ValueError):module.certify(*args)
if __name__=='__main__':unittest.main()
