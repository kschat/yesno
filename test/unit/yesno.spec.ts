import { expect } from 'chai';
import * as fse from 'fs-extra';
import _ from 'lodash';
import * as path from 'path';
import rp from 'request-promise';
import rimraf = require('rimraf');
import * as sinon from 'sinon';
import { SinonSandbox as Sandbox } from 'sinon';
import yesno from '../../src';
import { YESNO_RECORDING_MODE_ENV_VAR } from '../../src/consts';
import { IHttpMock } from '../../src/file';
import { ComparatorFn, IComparatorMetadata } from '../../src/filtering/comparator';
import { ISerializedRequest } from '../../src/http-serializer';
import { RecordMode } from '../../src/recording';
import * as testServer from '../test-server';

type PartialDeep<T> = { [P in keyof T]?: PartialDeep<T[P]> };

describe('Yesno', () => {
  const dir: string = path.join(__dirname, 'tmp');
  const mocksDir = path.join(__dirname, 'mocks');
  let server: testServer.ITestServer;

  const sandbox: Sandbox = sinon.createSandbox();

  afterEach(async () => {
    sandbox.restore();
    await new Promise((res, rej) => rimraf(`${__dirname}/tmp/*`, (e) => (e ? rej(e) : res())));
  });

  function requestTestServer(options: object = {}) {
    return rp({
      method: 'GET',
      uri: 'http://localhost:3001/get',
      ...options,
    });
  }

  function mockedRequest(options: object = {}) {
    return rp({
      headers: {
        'x-fiz': 'baz',
      },
      method: 'POST',
      uri: 'http://example.com/my/path',
      ...options,
    });
  }

  before(async () => {
    server = await testServer.start();
  });

  afterEach(() => {
    yesno.restore();
  });

  after(() => {
    server.close();
  });

  describe('#restore', () => {
    it('should restore normal HTTP functionality after mocking', async () => {
      const startingRequestCount = server.getRequestCount();
      await requestTestServer();
      expect(server.getRequestCount(), 'Unmocked').to.eql(startingRequestCount + 1);

      yesno.mock(await yesno.load({ filename: `${mocksDir}/mock-localhost-get-yesno.json` }));
      await requestTestServer();
      expect(server.getRequestCount(), 'Mocked').to.eql(startingRequestCount + 1);

      yesno.restore();
      await requestTestServer();
      expect(server.getRequestCount(), 'Unmocked again').to.eql(startingRequestCount + 2);

      await yesno.mock(await yesno.load({ filename: `${mocksDir}/mock-localhost-get-yesno.json` }));
      await requestTestServer();
      expect(server.getRequestCount(), 'Mocked again').to.eql(startingRequestCount + 2);
    });
  });

  describe('#spy', () => {
    it('should enable the interceptor');
    it('should give us access to intercepted requests');
    it('should handle timeouts');
    it('should handle invalid SSL');
    it('should support application/json');
    it('should support application/x-www-form-url-encoded');

    it('should proxy status code', async () => {
      yesno.spy();
      await expect(requestTestServer({ headers: { 'x-status-code': 500 } })).to.be.rejected;
      expect(yesno.matching(/get/).response()).to.have.property('statusCode', 500);
    });

    it('should support multipart/form-data', async () => {
      yesno.spy();

      await rp({
        formData: {
          fooBuffer: Buffer.from('foo-buffer'),
          fooString: 'foobar-string',
        },
        method: 'POST',
        uri: 'http://localhost:3001/post',
      });

      const intercepted = yesno.intercepted();
      expect(intercepted).to.have.lengthOf(1);
      expect(intercepted[0].request.body).to.match(
        /Content-Disposition: form-data; name="fooString"\s+foobar-string/,
      );
      expect(intercepted[0].request.body).to.match(
        /Content-Disposition: form-data; name="fooBuffer"\s+Content-Type: application\/octet-stream\s+foo-buffer/,
      );
    });

    it('should support binary');
  });

  describe('#mock', () => {
    function createMock(options: PartialDeep<IHttpMock> = {}): IHttpMock {
      return _.merge(
        {
          request: {
            host: 'localhost',
            method: 'GET',
            path: '/get',
            port: 3001,
            protocol: 'http',
          },
          response: {
            body: 'foobar',
            statusCode: 200,
          },
        },
        options,
      ) as IHttpMock;
    }
    beforeEach(async () => {
      await yesno.mock(await yesno.load({ filename: `${mocksDir}/mock-test-yesno.json` }));
    });

    afterEach(() => {
      yesno.clear();
    });

    it('should fulfil a matching request', async () => {
      const response = await mockedRequest();
      expect(response).to.eql('mock body');
    });

    it('should allow providing mocks', async () => {
      yesno.mock([createMock()]);

      expect(yesno.intercepted()).to.have.lengthOf(0);
      const response = await requestTestServer();
      expect(response).to.eql('foobar');
      expect(yesno.intercepted()).to.have.lengthOf(1);
    });

    it('should replace the mocks on subsequent calls but preserve existing intercepted requests');

    it('should throw an error if a mock shape is invalid', () => {
      const mocks = [createMock(), createMock()];
      (mocks[0] as any).request.host = undefined;

      expect(() => yesno.mock(mocks)).to.throw(
        'YesNo: Invalid serialized HTTP. (Errors: Expecting Readonly<string> at 0.request.host but instead got: undefined.)',
      );
    });

    it('should allow providing mocks with JSON response bodies as objects', async () => {
      yesno.mock([
        createMock({
          response: {
            body: { foo: 'bar' },
          },
        }),
      ]);

      expect(yesno.intercepted()).to.have.lengthOf(0);
      expect(await requestTestServer({ json: true })).to.eql({ foo: 'bar' });
      expect(yesno.intercepted()).to.have.lengthOf(1);
    });

    it('should reject a request for which no mock has been provided');
    it('should handle unexpected errors');

    it('should reject for host mismatch', async () => {
      await expect(mockedRequest({ uri: 'http://foobar.com/my/path' })).to.be.rejectedWith(
        /YesNo: Request does not match mock. Expected host "example.com" for request #0, received "foobar.com"/,
      );
    });

    it('should reject for method mismatch', async () => {
      await expect(mockedRequest({ method: 'GET' })).to.be.rejectedWith(
        /YesNo: Request does not match mock. Expected request #0 for example.com to HTTP method "POST", not "GET"/,
      );
    });

    it('should reject for HTTP protocol mismatch', async () => {
      await expect(mockedRequest({ uri: 'https://example.com/my/path' })).to.be.rejectedWith(
        /YesNo: Request does not match mock. Expected request #0 for example.com to use "http" protocol, not "https"/,
      );
    });

    it('should reject for port mismatch', async () => {
      await expect(mockedRequest({ uri: 'http://example.com:443/my/path' })).to.be.rejectedWith(
        /YesNo: Request does not match mock. Expected request #0 for example.com to be served on port "80", not "443"/,
      );
    });

    it('should reject for path mismatch', async () => {
      await expect(mockedRequest({ uri: 'http://example.com/my/foobar' })).to.be.rejectedWith(
        /Request does not match mock. Expected request #0 "POST http:\/\/example.com:80" to have path "\/my\/path", not "\/my\/foobar"/,
      );
    });

    it('should accept an optional comparatorFn, which can throw to reject a mock', async () => {
      const mockErrorMessage = 'some-error';
      const mockError = new Error(mockErrorMessage);

      const comparatorFn: ComparatorFn = (
        intercepted: ISerializedRequest,
        mock: ISerializedRequest,
        metadata: IComparatorMetadata,
      ): boolean => {
        throw mockError;
      };

      yesno.mock([createMock()], { comparatorFn });
      await expect(requestTestServer()).rejectedWith(mockErrorMessage);
    });

    it('should accept an optional comparatorFn, which can accept a mock when it does not throw', async () => {
      const comparatorFn: ComparatorFn = (
        intercepted: ISerializedRequest,
        mock: ISerializedRequest,
        metadata: IComparatorMetadata,
      ): boolean => {
        return true;
      };

      yesno.mock([createMock()], { comparatorFn });

      expect(yesno.intercepted()).to.have.lengthOf(0);
      const response = await requestTestServer();
      expect(response).to.eql('foobar');
      expect(yesno.intercepted()).to.have.lengthOf(1);
    });
  });

  describe('#recording', () => {
    describe('if "spy" mode', () => {
      const filename = path.join(__dirname, 'tmp', 'recording-spy.json');

      before(() => (process.env[YESNO_RECORDING_MODE_ENV_VAR] = RecordMode.Spy));

      it('should make live requests', async () => {
        await yesno.recording({ filename });
        const reqCount = server.getRequestCount();

        await requestTestServer();

        expect(yesno.intercepted()).to.have.lengthOf(1);

        expect(server.getRequestCount()).to.eql(reqCount + 1);
      });

      it('should not persist the recording', async () => {
        const recording = await yesno.recording({ filename });

        await requestTestServer();
        await recording.complete();

        expect(fse.existsSync(filename)).to.be.false;
      });
    });

    describe('if "record" mode', () => {
      const filename = path.join(__dirname, 'tmp', 'recording-record.json');

      before(() => (process.env[YESNO_RECORDING_MODE_ENV_VAR] = RecordMode.Record));

      it('should make live requests', async () => {
        await yesno.recording({ filename });
        const reqCount = server.getRequestCount();

        await requestTestServer();

        expect(yesno.intercepted()).to.have.lengthOf(1);

        expect(server.getRequestCount()).to.eql(reqCount + 1);
      });

      it('should persist the recording', async () => {
        const recording = await yesno.recording({ filename });

        await requestTestServer();
        await recording.complete();

        expect(fse.existsSync(filename)).to.be.true;
      });
    });

    describe('if "mock" mode', () => {
      const filename = path.join(__dirname, 'mocks', 'recording-mock.json');

      before(() => (process.env[YESNO_RECORDING_MODE_ENV_VAR] = RecordMode.Mock));

      it('should mock responses', async () => {
        await yesno.recording({ filename });
        const reqCount = server.getRequestCount();

        await requestTestServer();

        expect(yesno.intercepted()).to.have.lengthOf(1);

        expect(server.getRequestCount()).to.eql(reqCount);
      });

      it('should not persist the recording', async () => {
        const tmpFilename = path.join(__dirname, 'tmp', 'recording-mock.json');
        await fse.writeFile(tmpFilename, await fse.readFileSync(filename));

        const recording = await yesno.recording({ filename: tmpFilename });
        await fse.unlink(tmpFilename); // Delete fixtures, so that we can verify new ones aren't persisted

        await requestTestServer();
        await recording.complete();

        expect(fse.existsSync(tmpFilename)).to.be.false;
      });
    });
  });

  describe('#test', () => {
    beforeEach(() => {
      process.env[YESNO_RECORDING_MODE_ENV_VAR] = RecordMode.Spy;
    });

    it('should create a recordable test', async () => {
      process.env[YESNO_RECORDING_MODE_ENV_VAR] = RecordMode.Record;

      const mockTestFn = sandbox.mock(); // eg jest.test
      const mockTest = sandbox.mock();
      const expectedFilename = `${dir}/test-title-yesno.json`;
      const expectedFilenamePrefix = `${dir}/foobar-test-title-yesno.json`;

      const recordedTest = yesno.test({ test: mockTestFn, dir });
      const recordedTestPrefix = yesno.test({ test: mockTestFn, dir, prefix: 'foobar' });
      recordedTest('test title', mockTest);

      expect(mockTestFn).to.have.been.calledOnceWith('test title');

      expect(fse.existsSync(expectedFilename)).to.be.false;
      expect(fse.existsSync(expectedFilenamePrefix)).to.be.false;
      expect(mockTest).to.not.have.been.called;

      const callback = mockTestFn.args[0][1];
      await callback();

      expect(mockTest).to.have.been.calledOnce;
      expect(fse.existsSync(expectedFilename)).to.be.true;

      mockTestFn.reset();
      mockTest.reset();

      recordedTestPrefix('test title', mockTest);
      const callbackPrefix = mockTestFn.args[0][1];
      await callbackPrefix();

      expect(fse.existsSync(expectedFilenamePrefix)).to.be.true;
    });

    it('should restore behavior before and after the test regardless of whether it passes', async () => {
      const mockTestFn = sandbox.mock(); // eg jest.test
      const mockTest = sandbox.mock().resolves();
      const mockTestReject = sandbox.mock().rejects(new Error('Mock reject'));
      const mockTestThrow = sandbox.mock().throws(new Error('Mock throw'));
      const restoreSpy = sandbox.spy(yesno, 'restore');

      const recordedTest = yesno.test({ test: mockTestFn, dir });

      // Success
      recordedTest('test success', mockTest);
      const successTestCallback = mockTestFn.args[0][1];
      mockTestFn.reset();

      expect(restoreSpy).to.have.callCount(0);
      await successTestCallback();
      expect(restoreSpy).to.have.callCount(2);
      restoreSpy.resetHistory();

      // Rejected
      recordedTest('test reject', mockTestReject);
      const rejectTestCallback = mockTestFn.args[0][1];
      mockTestFn.reset();

      expect(restoreSpy).to.have.callCount(0);
      await expect(rejectTestCallback()).to.be.rejectedWith('Mock reject');
      expect(restoreSpy).to.have.callCount(2);
      restoreSpy.resetHistory();

      // Thrown
      recordedTest('test throw', mockTestThrow);
      const throwTestCallback = mockTestFn.args[0][1];
      mockTestFn.reset();

      expect(restoreSpy).to.have.callCount(0);
      await expect(throwTestCallback()).to.be.rejectedWith('Mock throw');
      expect(restoreSpy).to.have.callCount(2);
      restoreSpy.resetHistory();
    });
  });

  describe('#save', () => {
    it('should create the directory if it does not exist', async () => {
      const nestedDir = `${__dirname}/tmp/my/dir`;
      const filename = `${nestedDir}/file.json`;

      expect(fse.existsSync(nestedDir)).to.be.false;
      expect(fse.existsSync(filename)).to.be.false;

      await yesno.save({ filename });
      expect(fse.existsSync(filename)).to.be.true;
    });

    it('should save intercepted requests');
    it('should throw an error if there are any in flight requests');
    it('should take no action in mock mode (if not provided requests)');
    it('should allow setting the full filename');
    it('should allow providing the records');
  });

  describe('#load', () => {
    it('should load serialized requests by name & dir');
    it('should load serialized requests by filename');
    it('should support application/json');
    it('should support x-www-form-url-encoded');
    it('should support binary');
    it('should support form-data');
    it('should throw an error if a record is not formatted correctly');
  });

  describe('#intercepted', () => {
    it('should call FilteredHttpCollection#intercepted() with no query');
  });

  describe('#mocks', () => {
    it('should call FilteredHttpCollection#mocks() with no query');
  });

  describe('#redact', () => {
    it('should call FilteredHttpCollection#redact() with no query');
  });

  describe('#matching', () => {
    it('should call FilteredHttpCollection#redact() with the provided query');

    it('should allow for no parameters', async () => {
      yesno.spy();
      await expect(requestTestServer({ headers: { 'x-status-code': 500 } })).to.be.rejected;
      expect(yesno.matching().response()).to.have.property('statusCode', 500);
    });
  });
});
