const test=require('node:test');
const assert=require('node:assert/strict');
const load=require('./helpers/loadComponent.cjs');
test('research build cannot start Live Activities or schedule driving alerts',async()=>{
 let alerts=0;
 const policy=load('src/lib/drivingResearchPolicy.js',{'react-native':{Platform:{OS:'ios'}},'../../modules/fuel-up-driving-activity':{__esModule:true,default:{ownsBackgroundTracking:()=>true}}});
 const api=load('src/lib/notifications.js',{
  './drivingResearchPolicy':policy,'expo-device':{},'expo-constants':{},'react-native':{Platform:{OS:'ios'},Linking:{}},
  'expo-notifications':{scheduleNotificationAsync:()=>{alerts++},setNotificationCategoryAsync:()=>{alerts++}},
 });
 assert.equal(await api.startPredictiveLiveActivity({}),undefined);
 assert.equal(api.startLiveActivity('Station',3),undefined);
 assert.equal(api.updatePredictiveLiveActivity({update:()=>{alerts++}},{}),false);
 assert.equal(await api.schedulePredictiveRecommendationNotification({}),null);
 assert.equal(alerts,0);
});
test('native migration unregisters old tasks before native collection resumes',async()=>{
 const calls=[];
 const api=load('src/lib/drivingResearch.js',{
  './drivingResearchPolicy':{nativeResearchOwnsTracking:()=>true},
  '../../modules/fuel-up-driving-activity':{__esModule:true,default:{resumeResearchAsync:async()=>calls.push('resume')}},
  'expo-location':{hasStartedLocationUpdatesAsync:async()=>true,hasStartedGeofencingAsync:async()=>true,
   stopLocationUpdatesAsync:async()=>calls.push('stop-location'),stopGeofencingAsync:async()=>calls.push('stop-fences')},
  './notifications':{endAllLiveActivities:async()=>calls.push('end-activities')},
  'expo-notifications':{getAllScheduledNotificationsAsync:async()=>[{identifier:'own',content:{categoryIdentifier:'fuelup.predictive-recommendation'}},{identifier:'other',content:{}}],cancelScheduledNotificationAsync:async id=>calls.push('cancel-'+id)},
 });
 await api.migrateToNativeResearchAsync();
 assert.deepEqual(calls,['stop-location','stop-fences','end-activities','cancel-own','resume']);
});
