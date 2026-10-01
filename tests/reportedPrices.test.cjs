const test = require('node:test');
const assert = require('node:assert/strict');
const { isFreshReportedPrice, isFreshReportedQuote, freshReportedStation, filterReportedSnapshot } = require('../src/services/fuel/reportedPrices');
const now = Date.parse('2026-10-01T15:00:00Z'), day = 86400000;
const time = offset => new Date(now + offset).toISOString();
const quote = (id, price, offset = -1000) => ({ stationId:id, providerTier:'station', fuelType:'regular', price,
  updatedAt:time(offset), fetchedAt:time(0), distanceMiles:1 });

test('24-hour eligibility uses the price posting time and rejects missing, future, or non-positive data', () => {
  assert(isFreshReportedPrice(3.5,time(-day),now));
  assert(!isFreshReportedPrice(3.5,time(-day-1),now));
  for (const posted of [null,'garbage',time(1)]) assert(!isFreshReportedPrice(3.5,posted,now));
  for (const price of [0,-1,NaN,Infinity,null,'3.5']) assert(!isFreshReportedPrice(price,time(-1),now));
  assert(!isFreshReportedQuote(quote('old',3,-day-1),now));
  assert(!isFreshReportedQuote({...quote('predicted',3),validation:{usedPrediction:true}},now));
  assert(!isFreshReportedQuote({...quote('predicted',3),validationByFuelType:{regular:{usedPrediction:true}}},now));
  assert(!isFreshReportedQuote({...quote('estimated',3),isEstimated:true},now));
});
test('grade/payment ages are independent and filtering does not overwrite the archive object', () => {
  const station = {id:'s',prices:[
    {fuelProduct:'regular_gas',credit:{price:4,postedTime:time(-day-1)},cash:{price:3.9,postedTime:time(-1000)}},
    {fuelProduct:'premium_gas',credit:{price:5,postedTime:time(-day-1)}},
    {fuelProduct:'diesel',credit:{price:6}},
  ]};
  const before = JSON.stringify(station), fresh = freshReportedStation(station,now);
  assert.equal(fresh.prices.length,1);assert.equal(fresh.prices[0].credit,null);
  assert.equal(fresh.prices[0].cash.price,3.9);assert.equal(JSON.stringify(station),before);
});
test('local snapshots cannot revive old corrections or keep an expired cheapest price', () => {
  const expired=quote('expired',2,-day-1), next=quote('fresh',4), corrected={...quote('corrected',3),validation:{usedPrediction:true}};
  const snapshot=filterReportedSnapshot({quote:expired,topStations:[expired,next,corrected],regionalQuotes:[{price:2,isEstimated:true}]},now);
  assert.equal(snapshot.quote.stationId,'fresh');assert.deepEqual(snapshot.topStations,[next]);assert.deepEqual(snapshot.regionalQuotes,[]);
  assert.equal(filterReportedSnapshot({quote:expired,topStations:[expired]},now).quote,null);
});
