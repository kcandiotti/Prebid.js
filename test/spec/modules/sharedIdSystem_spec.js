import {sharedIdSystemSubmodule} from 'modules/sharedIdSystem.js';
import {config} from 'src/config.js';

import sinon from 'sinon';
import * as utils from 'src/utils.js';
import {createEidsArray} from '../../../modules/userId/eids.js';
import {attachIdSystem} from '../../../modules/userId/index.js';
import {getGlobal} from '../../../src/prebidGlobal.js';

const expect = require('chai').expect;

describe('SharedId System', function () {
  const UUID = '15fde1dc-1861-4894-afdf-b757272f3568';

  before(function () {
    sinon.stub(utils, 'generateUUID').returns(UUID);
    sinon.stub(utils, 'logInfo');
  });

  after(function () {
    utils.generateUUID.restore();
    utils.logInfo.restore();
  });
  describe('SharedId System getId()', function () {
    const callbackSpy = sinon.spy();

    let sandbox;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      sandbox.stub(utils, 'hasDeviceAccess').returns(true);
      callbackSpy.resetHistory();
    });

    afterEach(function () {
      sandbox.restore();
    });

    it('should call UUID', function () {
      const config = {
        storage: {
          type: 'cookie',
          name: '_pubcid',
          expires: 10
        }
      };

      const submoduleCallback = sharedIdSystemSubmodule.getId(config, undefined).callback;
      submoduleCallback(callbackSpy);
      expect(callbackSpy.calledOnce).to.be.true;
      expect(callbackSpy.lastCall.lastArg).to.equal(UUID);
    });
    it('should abort if coppa is set', function () {
      const result = sharedIdSystemSubmodule.getId({}, {coppa: true});
      expect(result).to.be.undefined;
    });
  });
  describe('SharedId System extendId()', function () {
    const callbackSpy = sinon.spy();
    let sandbox;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      sandbox.stub(utils, 'hasDeviceAccess').returns(true);
      callbackSpy.resetHistory();
    });
    afterEach(function () {
      sandbox.restore();
    });
    it('should call UUID', function () {
      const config = {
        params: {
          extend: true
        },
        storage: {
          type: 'cookie',
          name: '_pubcid',
          expires: 10
        }
      };
      const pubcommId = sharedIdSystemSubmodule.extendId(config, undefined, 'TestId').id;
      expect(pubcommId).to.equal('TestId');
    });
    it('should abort if coppa is set', function () {
      const result = sharedIdSystemSubmodule.extendId({params: {extend: true}}, {coppa: true}, 'TestId');
      expect(result).to.be.undefined;
    });
  });
  describe('eid', () => {
    before(() => {
      attachIdSystem(sharedIdSystemSubmodule);
    });
    afterEach(() => {
      config.resetConfig();
    });
    it('pubCommonId', function() {
      const userId = {
        pubcid: 'some-random-id-value'
      };
      const newEids = createEidsArray(userId);
      expect(newEids.length).to.equal(1);
      expect(newEids[0]).to.deep.equal({
        source: 'pubcid.org',
        uids: [{id: 'some-random-id-value', atype: 1}]
      });
    });

    it('should set inserter, if provided in config', async () => {
      config.setConfig({
        userSync: {
          userIds: [{
            name: 'sharedId',
            params: {
              inserter: 'mock-inserter'
            },
            value: {pubcid: 'mock-id'}
          }]
        }
      });
      await getGlobal().refreshUserIds();
      const eids = getGlobal().getUserIdsAsEids();
      sinon.assert.match(eids[0], {
        source: 'pubcid.org',
        inserter: 'mock-inserter'
      })
    })
  })
});
