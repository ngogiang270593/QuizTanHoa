import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatVietnamDateTime,parseVietnamDateTimeInput} from '../src/dateTime.js';
import {parseLocal,local} from '../../worker/common.mjs';

test('Vietnam datetime retains seconds independently of device timezone',()=>{
  assert.equal(formatVietnamDateTime('2030-01-10T01:02:03Z'),'10/01/2030 08:02:03');
  assert.equal(parseVietnamDateTimeInput('10/01/2030 08:02:03'),'2030-01-10T08:02:03');
  assert.equal(parseLocal('10/01/2030 08:02:03'),'2030-01-10T01:02:03.000Z');
  assert.equal(local('2030-01-10T01:02:03Z'),'10/01/2030 08:02:03');
});
test('legacy minute schedules default to zero seconds without moving the time',()=>{
  assert.equal(parseVietnamDateTimeInput('10/01/2030 08:02'),'2030-01-10T08:02:00');
  assert.equal(parseLocal('10/01/2030 08:02'),'2030-01-10T01:02:00.000Z');
  assert.equal(parseLocal('2030-01-10T08:02:03'),'2030-01-10T01:02:03.000Z');
});
test('rejects impossible dates and invalid clock values while allowing leap days',()=>{
  for(const value of ['31/04/2030 08:00:00','29/02/2030 08:00:00','10/01/2030 24:00:00','10/01/2030 08:60:00','10/01/2030 08:00:60','10/01/2030 08:00:99']) {
    assert.equal(parseVietnamDateTimeInput(value),null,value);
    assert.throws(()=>parseLocal(value),undefined,value);
  }
  assert.equal(parseLocal('29/02/2028 23:59:59'),'2028-02-29T16:59:59.000Z');
});
