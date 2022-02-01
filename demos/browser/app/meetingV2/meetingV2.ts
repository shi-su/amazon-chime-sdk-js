// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import './styleV2.scss';
import 'bootstrap';

import {
  ApplicationMetadata,
  AsyncScheduler,
  Attendee,
  AudioInputDevice,
  AudioProfile,
  AudioVideoFacade,
  AudioVideoObserver,
  BackgroundBlurProcessor,
  BackgroundBlurVideoFrameProcessor,
  BackgroundBlurVideoFrameProcessorObserver,
  BackgroundReplacementProcessor,
  BackgroundReplacementVideoFrameProcessor,
  BackgroundReplacementVideoFrameProcessorObserver,
  BackgroundReplacementOptions,
  ClientMetricReport,
  ClientVideoStreamReceivingReport,
  ConsoleLogger,
  ContentShareObserver,
  DataMessage,
  DefaultActiveSpeakerPolicy,
  DefaultAudioVideoController,
  DefaultBrowserBehavior,
  DefaultDeviceController,
  DefaultMeetingEventReporter,
  DefaultMeetingSession,
  DefaultModality,
  DefaultVideoTransformDevice,
  Device,
  DeviceChangeObserver,
  EventAttributes,
  EventIngestionConfiguration,
  EventName,
  EventReporter,
  LogLevel,
  Logger,
  MeetingEventsClientConfiguration,
  MeetingSession,
  MeetingSessionConfiguration,
  MeetingSessionPOSTLogger,
  MeetingSessionStatus,
  MeetingSessionStatusCode,
  MeetingSessionVideoAvailability,
  MultiLogger,
  NoOpEventReporter,
  NoOpVideoFrameProcessor,
  RemovableAnalyserNode,
  SimulcastLayers,
  Transcript,
  TranscriptEvent,
  TranscriptionStatus,
  TranscriptionStatusType,
  TranscriptItemType,
  TranscriptResult,
  Versioning,
  VideoDownlinkObserver,
  VideoFrameProcessor,
  VideoInputDevice,
  VideoPriorityBasedPolicy,
  VideoPriorityBasedPolicyConfig,
  VoiceFocusDeviceTransformer,
  VoiceFocusModelComplexity,
  VoiceFocusModelName,
  VoiceFocusPaths,
  VoiceFocusSpec,
  VoiceFocusTransformDevice,
  isAudioTransformDevice,
  isDestroyable,
  BackgroundFilterSpec,
  BackgroundFilterPaths,
  ModelSpecBuilder,
  VideoCodecCapability,
  DefaultSimulcastUplinkPolicy,
  NScaleVideoUplinkBandwidthPolicy,
} from 'amazon-chime-sdk-js';

import TestSound from './audio/TestSound';

import VideoTileCollection from './video/VideoTileCollection'
import VideoPreferenceManager from './video/VideoPreferenceManager';

import CircularCut from './video/filters/CircularCut';
import EmojifyVideoFrameProcessor from './video/filters/EmojifyVideoFrameProcessor';
import SegmentationProcessor from './video/filters/SegmentationProcessor';
import ResizeProcessor from './video/filters/ResizeProcessor';
import {
  loadBodyPixDependency,
  platformCanSupportBodyPixWithoutDegradation,
} from './video/filters/SegmentationUtil';

let SHOULD_EARLY_CONNECT = (() => {
  return document.location.search.includes('earlyConnect=1');
})();

let SHOULD_DIE_ON_FATALS = (() => {
  const isLocal = document.location.host === '127.0.0.1:8080' || document.location.host === 'localhost:8080';
  const fatalYes = document.location.search.includes('fatal=1');
  const fatalNo = document.location.search.includes('fatal=0');
  return fatalYes || (isLocal && !fatalNo);
})();

let DEBUG_LOG_PPS = true;

export let fatal: (e: Error) => void;

// This shim is needed to avoid warnings when supporting Safari.
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext
  }
}

// Support a set of query parameters to allow for testing pre-release versions of
// Amazon Voice Focus. If none of these parameters are supplied, the SDK default
// values will be used.
const search = new URLSearchParams(document.location.search);
const VOICE_FOCUS_NAME = search.get('voiceFocusName') || undefined;
const VOICE_FOCUS_CDN = search.get('voiceFocusCDN') || undefined;
const VOICE_FOCUS_ASSET_GROUP = search.get('voiceFocusAssetGroup') || undefined;
const VOICE_FOCUS_REVISION_ID = search.get('voiceFocusRevisionID') || undefined;

const VOICE_FOCUS_PATHS: VoiceFocusPaths | undefined = VOICE_FOCUS_CDN && {
  processors: `${VOICE_FOCUS_CDN}processors/`,
  wasm: `${VOICE_FOCUS_CDN}wasm/`,
  workers: `${VOICE_FOCUS_CDN}workers/`,
  models: `${VOICE_FOCUS_CDN}wasm/`,
};

function voiceFocusName(name: string | undefined = VOICE_FOCUS_NAME): VoiceFocusModelName | undefined {
  if (name && ['default', 'ns_es'].includes(name)) {
    return name as VoiceFocusModelName;
  }
  return undefined;
}

const VOICE_FOCUS_SPEC = {
  name: voiceFocusName(),
  assetGroup: VOICE_FOCUS_ASSET_GROUP,
  revisionID: VOICE_FOCUS_REVISION_ID,
  paths: VOICE_FOCUS_PATHS,
};

function getVoiceFocusSpec(joinInfo: any): VoiceFocusSpec {
  const es = joinInfo.Meeting.Meeting?.MeetingFeatures?.Audio?.EchoReduction === 'AVAILABLE';
  let spec: VoiceFocusSpec = VOICE_FOCUS_SPEC;
  if (!spec.name) {
    spec.name =  es ? voiceFocusName('ns_es') : voiceFocusName('default');
  }
  return spec;
};

const MAX_VOICE_FOCUS_COMPLEXITY: VoiceFocusModelComplexity | undefined = undefined;

const BACKGROUND_BLUR_CDN = search.get('blurCDN') || undefined;
const BACKGROUND_BLUR_ASSET_GROUP = search.get('blurAssetGroup') || undefined;
const BACKGROUND_BLUR_REVISION_ID = search.get('blurRevisionID') || undefined;

const BACKGROUND_BLUR_PATHS: BackgroundFilterPaths = BACKGROUND_BLUR_CDN && {
  worker: `${BACKGROUND_BLUR_CDN}/bgblur/workers/worker.js`,
  wasm: `${BACKGROUND_BLUR_CDN}/bgblur/wasm/_cwt-wasm.wasm`,
  simd: `${BACKGROUND_BLUR_CDN}/bgblur/wasm/_cwt-wasm-simd.wasm`,
};
const BACKGROUND_BLUR_MODEL = BACKGROUND_BLUR_CDN && ModelSpecBuilder.builder()
    .withSelfieSegmentationDefaults()
    .withPath(`${BACKGROUND_BLUR_CDN}/bgblur/models/selfie_segmentation_landscape.tflite`)
    .build();
const BACKGROUND_BLUR_ASSET_SPEC = (BACKGROUND_BLUR_ASSET_GROUP || BACKGROUND_BLUR_REVISION_ID) && {
  assetGroup: BACKGROUND_BLUR_ASSET_GROUP,
  revisionID: BACKGROUND_BLUR_REVISION_ID,
}

type VideoFilterName = 'Emojify' | 'CircularCut' | 'NoOp' | 'Segmentation' | 'Resize (9/16)' | 'Background Blur 10% CPU' | 'Background Blur 20% CPU' | 'Background Blur 30% CPU' | 'Background Blur 40% CPU' | 'Background Replacement' | 'None';

const VIDEO_FILTERS: VideoFilterName[] = ['Emojify', 'CircularCut', 'NoOp', 'Resize (9/16)'];

export enum ContentShareType {
  ScreenCapture,
  VideoFile,
}

const SimulcastLayerMapping = {
  [SimulcastLayers.Low]: 'Low',
  [SimulcastLayers.LowAndMedium]: 'Low and Medium',
  [SimulcastLayers.LowAndHigh]: 'Low and High',
  [SimulcastLayers.Medium]: 'Medium',
  [SimulcastLayers.MediumAndHigh]: 'Medium and High',
  [SimulcastLayers.High]: 'High',
};

const LANGUAGES_NO_WORD_SEPARATOR = new Set([
  'ja-JP',
  'zh-CN',
]);

interface Toggle {
  name: string;
  oncreate: (elem: HTMLElement) => void;
  action: () => void;
}

interface TranscriptSegment {
  contentSpan: HTMLSpanElement,
  attendee: Attendee;
  startTimeMs: number;
  endTimeMs: number;
}

interface TranscriptionStreamParams {
  contentIdentificationType?: 'PII' | 'PHI';
  contentRedactionType?: 'PII';
  enablePartialResultsStability?: boolean;
  partialResultsStability?: string;
  piiEntityTypes?: string;
  languageModelName?: string;
}

export class DemoMeetingApp
  implements AudioVideoObserver, DeviceChangeObserver, ContentShareObserver, VideoDownlinkObserver {
  static readonly DID: string = '+17035550122';
  static readonly BASE_URL: string = [
    location.protocol,
    '//',
    location.host,
    location.pathname.replace(/\/*$/, '/').replace('/v2', ''),
  ].join('');
  static testVideo: string =
    'https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.360p.vp9.webm';
  static readonly LOGGER_BATCH_SIZE: number = 85;
  static readonly LOGGER_INTERVAL_MS: number = 2_000;
  static readonly MAX_MEETING_HISTORY_MS: number = 5 * 60 * 1000;
  static readonly DATA_MESSAGE_TOPIC: string = 'chat';
  static readonly DATA_MESSAGE_LIFETIME_MS: number = 300_000;

  // Currently this is the same as the maximum number of clients that can enable video (25)
  // so we id the check box 'enable-pagination' rather then 'reduce-pagionation', but technically pagination is always enabled.
  static readonly REMOTE_VIDEO_PAGE_SIZE: number = 25;
  // Enabled on authentication screen by 'enable-pagination' checkbox.
  static readonly REDUCED_REMOTE_VIDEO_PAGE_SIZE: number = 2;

  // Ideally we don't need to change this. Keep this configurable in case users have a super slow network.
  loadingBodyPixDependencyTimeoutMs: number = 10_000;
  loadingBodyPixDependencyPromise: undefined | Promise<void>;

  attendeeIdPresenceHandler: (undefined | ((attendeeId: string, present: boolean, externalUserId: string, dropped: boolean) => void)) = undefined;
  activeSpeakerHandler: (undefined | ((attendeeIds: string[]) => void)) = undefined;
  blurObserver: (undefined | BackgroundBlurVideoFrameProcessorObserver ) = undefined;
  replacementObserver: (undefined | BackgroundReplacementVideoFrameProcessorObserver ) = undefined;

  showActiveSpeakerScores = false;
  meeting: string | null = null;
  name: string | null = null;
  voiceConnectorId: string | null = null;
  sipURI: string | null = null;
  region: string | null = null;
  meetingSession: MeetingSession | null = null;
  priorityBasedDownlinkPolicy: VideoPriorityBasedPolicy | null = null;
  audioVideo: AudioVideoFacade | null = null;
  canStartLocalVideo: boolean = true;
  defaultBrowserBehaviour: DefaultBrowserBehavior = new DefaultBrowserBehavior();
  videoTileCollection: VideoTileCollection | undefined = undefined;
  videoPreferenceManager: VideoPreferenceManager | undefined = undefined;

  // eslint-disable-next-line
  roster: any = {};

  cameraDeviceIds: string[] = [];
  microphoneDeviceIds: string[] = [];
  currentAudioInputDevice: AudioInputDevice | undefined;

  buttonStates: { [key: string]: boolean } = {
    'button-microphone': true,
    'button-camera': false,
    'button-speaker': true,
    'button-content-share': false,
    'button-pause-content-share': false,
    'button-live-transcription': false,
    'button-video-stats': false,
    'button-video-filter': false,
    'button-record-self': false,
    'button-record-cloud': false,
  };

  contentShareType: ContentShareType = ContentShareType.ScreenCapture;

  // feature flags
  enableWebAudio = false;
  logLevel = LogLevel.INFO;
  preferredVideoCodec: VideoCodecCapability | undefined = undefined;
  enableSimulcast = false;
  usePriorityBasedDownlinkPolicy = false;
  videoPriorityBasedPolicyConfig = VideoPriorityBasedPolicyConfig.Default;
  enablePin = false;
  echoReductionCapability = false;
  usingStereoMusicAudioProfile = false;

  supportsVoiceFocus = false;
  enableVoiceFocus = false;
  voiceFocusIsActive = false;

  supportsBackgroundBlur = false;
  supportsBackgroundReplacement = false;

  enableLiveTranscription = false;
  noWordSeparatorForTranscription = false;

  markdown = require('markdown-it')({ linkify: true });
  lastMessageSender: string | null = null;
  lastReceivedMessageTimestamp = 0;
  meetingSessionPOSTLogger: MeetingSessionPOSTLogger;
  meetingEventPOSTLogger: MeetingSessionPOSTLogger;

  hasChromiumWebRTC: boolean = this.defaultBrowserBehaviour.hasChromiumWebRTC();

  voiceFocusTransformer: VoiceFocusDeviceTransformer | undefined;
  voiceFocusDevice: VoiceFocusTransformDevice | undefined;
  joinInfo: any | undefined;

  blurProcessor: BackgroundBlurProcessor | undefined;
  replacementProcessor: BackgroundReplacementProcessor | undefined;
  replacementOptions: BackgroundReplacementOptions | undefined;

  // This is an extremely minimal reactive programming approach: these elements
  // will be updated when the Amazon Voice Focus display state changes.
  voiceFocusDisplayables: HTMLElement[] = [];
  analyserNode: RemovableAnalyserNode;

  liveTranscriptionDisplayables: HTMLElement[] = [];

  chosenVideoTransformDevice: DefaultVideoTransformDevice;
  chosenVideoFilter: VideoFilterName = 'None';
  selectedVideoFilterItem: VideoFilterName = 'None';

  meetingLogger: Logger | undefined = undefined;

  // If you want to make this a repeatable SPA, change this to 'spa'
  // and fix some state (e.g., video buttons).
  // Holding Shift while hitting the Leave button is handled by setting
  // this to `halt`, which allows us to stop and measure memory leaks.
  behaviorAfterLeave: 'spa' | 'reload' | 'halt' = 'reload';

  videoMetricReport: { [id: string]: { [id: string]: {} } } = {};

  removeFatalHandlers: () => void;

  transcriptContainerDiv = document.getElementById('transcript-container') as HTMLDivElement;
  partialTranscriptDiv: HTMLDivElement | undefined;
  partialTranscriptResultTimeMap = new Map<string, number>();
  partialTranscriptResultMap = new Map<string, TranscriptResult>();
  transcriptEntitySet = new Set<string>();

  addFatalHandlers(): void {
    fatal = this.fatal.bind(this);

    const onEvent = (event: ErrorEvent): void => {
      // In Safari there's only a message.
      fatal(event.error || event.message);
    };

    // Listen for unhandled errors, too.
    window.addEventListener('error', onEvent);

    window.onunhandledrejection = (event: PromiseRejectionEvent) => {
      fatal(event.reason);
    };

    this.removeFatalHandlers = () => {
      window.onunhandledrejection = undefined;
      window.removeEventListener('error', onEvent);
      fatal = undefined;
      this.removeFatalHandlers = undefined;
    }
  }

  eventReporter: EventReporter | undefined = undefined;
  enableEventReporting = false;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).app = this;

    this.addFatalHandlers();

    if (document.location.search.includes('testfatal=1')) {
      this.fatal(new Error('Testing fatal.'));
      return;
    }

    (document.getElementById('sdk-version') as HTMLSpanElement).innerText =
      'amazon-chime-sdk-js@' + Versioning.sdkVersion;
    this.initEventListeners();
    this.initParameters();
    this.setMediaRegion();
    if (this.isRecorder() || this.isBroadcaster()) {
      AsyncScheduler.nextTick(async () => {
        this.meeting = new URL(window.location.href).searchParams.get('m');
        this.name = this.isRecorder() ? '«Meeting Recorder»' : '«Meeting Broadcaster»';
        await this.authenticate();
        await this.openAudioOutputFromSelection();
        await this.join();
        this.displayButtonStates();
        this.switchToFlow('flow-meeting');
      });
    } else {
      this.switchToFlow('flow-authenticate');
    }
  }

  /**
   * We want to make it abundantly clear at development and testing time
   * when an unexpected error occurs.
   * If we're running locally, or we passed a `fatal=1` query parameter, fail hard.
   */
  fatal(e: Error | string): void {
    // Muffle mode: let the `try-catch` do its job.
    if (!SHOULD_DIE_ON_FATALS) {
      console.info('Ignoring fatal', e);
      return;
    }

    console.error('Fatal error: this was going to be caught, but should not have been thrown.', e);

    if (e && e instanceof Error) {
      document.getElementById('stack').innerText = e.message + '\n' + e.stack?.toString();
    } else {
      document.getElementById('stack').innerText = '' + e;
    }

    this.switchToFlow('flow-fatal');
  }

  initParameters(): void {
    const meeting = new URL(window.location.href).searchParams.get('m');
    if (meeting) {
      (document.getElementById('inputMeeting') as HTMLInputElement).value = meeting;
      (document.getElementById('inputName') as HTMLInputElement).focus();
    } else {
      (document.getElementById('inputMeeting') as HTMLInputElement).focus();
    }
  }

  async initVoiceFocus(): Promise<void> {
    const logger = new ConsoleLogger('SDK', LogLevel.DEBUG);
    if (!this.enableWebAudio) {
      logger.info('[DEMO] Web Audio not enabled. Not checking for Amazon Voice Focus support.');
      return;
    }

    const spec: VoiceFocusSpec = getVoiceFocusSpec(this.joinInfo);

    try {
      this.supportsVoiceFocus = await VoiceFocusDeviceTransformer.isSupported(spec, {
        logger,
      });
      if (this.supportsVoiceFocus) {
        this.voiceFocusTransformer = await this.getVoiceFocusDeviceTransformer(MAX_VOICE_FOCUS_COMPLEXITY);
        this.supportsVoiceFocus =
          this.voiceFocusTransformer && this.voiceFocusTransformer.isSupported();
        if (this.supportsVoiceFocus) {
          logger.info('[DEMO] Amazon Voice Focus is supported.');
          document.getElementById('voice-focus-setting').classList.remove('hidden');
          return;
        }
      }
    } catch (e) {
      // Fall through.
      logger.warn(`[DEMO] Does not support Amazon Voice Focus: ${e.message}`);
    }
    logger.warn('[DEMO] Does not support Amazon Voice Focus.');
    this.supportsVoiceFocus = false;
    document.getElementById('voice-focus-setting').classList.toggle('hidden', true);
  }

  async initBackgroundBlur(): Promise<void> {
      try {
        this.supportsBackgroundBlur = await BackgroundBlurVideoFrameProcessor.isSupported(this.getBackgroundBlurSpec());
      }
      catch (e) {
        this.log(`[DEMO] Does not support background blur: ${e.message}`);
        this.supportsBackgroundBlur = false;
      }
  }

  async createReplacementImageBlob(startColor: string, endColor: string): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = 500; 
    canvas.height = 500;
    const ctx = canvas.getContext('2d');
    const grd = ctx.createLinearGradient(0, 0, 250, 0);
    grd.addColorStop(0, startColor);
    grd.addColorStop(1, endColor);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 500, 500);
    const blob = await new Promise<Blob> (resolve => {
      canvas.toBlob(resolve);
    });
    return blob;
  }

  /**
  * The image blob in this demo is created by generating an image
  * from a canvas, but another common scenario would be to provide 
  * an image blob from fetching a URL.
  *   const image = await fetch('https://someimage.jpeg');
  *   const imageBlob = await image.blob();
  */
  async getBackgroundReplacementOptions(): Promise<BackgroundReplacementOptions> {
    if (!this.replacementOptions) {
      const imageBlob = await this.createReplacementImageBlob('#000428', '#004e92');
      this.replacementOptions = { imageBlob };
    }
    return this.replacementOptions;
  }

  async initBackgroundReplacement(): Promise<void> {
    try {
      this.supportsBackgroundReplacement = await BackgroundReplacementVideoFrameProcessor.isSupported(this.getBackgroundBlurSpec(), await this.getBackgroundReplacementOptions());
    }
    catch (e) {
      this.log(`[DEMO] Does not support background replacement: ${e.message}`);
      this.supportsBackgroundReplacement = false;
    }
  }

  private async onVoiceFocusSettingChanged(): Promise<void> {
    this.log('[DEMO] Amazon Voice Focus setting toggled to', this.enableVoiceFocus);
    this.openAudioInputFromSelectionAndPreview();
  }

  initEventListeners(): void {
    if (!this.defaultBrowserBehaviour.hasChromiumWebRTC()) {
      (document.getElementById('simulcast') as HTMLInputElement).disabled = true;
    }

    if (!this.defaultBrowserBehaviour.supportDownlinkBandwidthEstimation()) {
      (document.getElementById('priority-downlink-policy') as HTMLInputElement).disabled = true;
    }

    document.getElementById('priority-downlink-policy').addEventListener('change', e => {
      this.usePriorityBasedDownlinkPolicy = (document.getElementById('priority-downlink-policy') as HTMLInputElement).checked;

      const priorityBasedDownlinkPolicyConfig = document.getElementById(
        'priority-downlink-policy-preset'
      ) as HTMLSelectElement;
      const enablePaginationCheckbox = document.getElementById(
        'enable-pagination-checkbox'
      ) as HTMLSelectElement;


      if (this.usePriorityBasedDownlinkPolicy) {
        priorityBasedDownlinkPolicyConfig.style.display = 'block';
        enablePaginationCheckbox.style.display = 'block';
      } else {
        priorityBasedDownlinkPolicyConfig.style.display = 'none';
        enablePaginationCheckbox.style.display = 'none';
      }
    });

    const echoReductionCheckbox = (document.getElementById('echo-reduction-checkbox') as HTMLInputElement);
    (document.getElementById('webaudio') as HTMLInputElement).addEventListener('change', e => {
      this.enableWebAudio = (document.getElementById('webaudio') as HTMLInputElement).checked;
      if (this.enableWebAudio) {
        echoReductionCheckbox.style.display = 'block';
      } else {
        echoReductionCheckbox.style.display = 'none';
      }
    });

    const presetDropDown = document.getElementById('priority-downlink-policy-preset') as HTMLSelectElement;
    presetDropDown.addEventListener('change', async e => {
      switch (presetDropDown.value) {
        case 'stable':
          this.videoPriorityBasedPolicyConfig = VideoPriorityBasedPolicyConfig.StableNetworkPreset;
          break;
        case 'unstable':
          this.videoPriorityBasedPolicyConfig = VideoPriorityBasedPolicyConfig.UnstableNetworkPreset;
          break;
        case 'default':
          this.videoPriorityBasedPolicyConfig = VideoPriorityBasedPolicyConfig.Default;
          break;
      }
      this.log('priority-downlink-policy-preset is changed: ' + presetDropDown.value);
    });

    document.getElementById('form-authenticate').addEventListener('submit', e => {
      e.preventDefault();
      this.meeting = (document.getElementById('inputMeeting') as HTMLInputElement).value;
      this.name = (document.getElementById('inputName') as HTMLInputElement).value;
      this.region = (document.getElementById('inputRegion') as HTMLInputElement).value;
      this.enableSimulcast = (document.getElementById('simulcast') as HTMLInputElement).checked;
      this.enableEventReporting = (document.getElementById('event-reporting') as HTMLInputElement).checked;
      this.enableWebAudio = (document.getElementById('webaudio') as HTMLInputElement).checked;
      this.usePriorityBasedDownlinkPolicy = (document.getElementById('priority-downlink-policy') as HTMLInputElement).checked;
      this.echoReductionCapability = (document.getElementById('echo-reduction-capability') as HTMLInputElement).checked;

      const chosenLogLevel = (document.getElementById('logLevelSelect') as HTMLSelectElement).value;
      switch (chosenLogLevel) {
        case 'INFO':
          this.logLevel = LogLevel.INFO;
          break;
        case 'DEBUG':
          this.logLevel = LogLevel.DEBUG;
          break;
        case 'WARN':
          this.logLevel = LogLevel.WARN;
          break;
        case 'ERROR':
          this.logLevel = LogLevel.ERROR;
          break;
        default:
          this.logLevel = LogLevel.OFF;
          break;
      }

      const chosenVideoSendCodec = (document.getElementById('videoCodecSelect') as HTMLSelectElement).value;
      switch (chosenVideoSendCodec) {
        case 'vp8':
          this.preferredVideoCodec = VideoCodecCapability.vp8();
          break;
        case 'h264ConstrainedBaselineProfile':
          this.preferredVideoCodec = VideoCodecCapability.h264ConstrainedBaselineProfile();
          break;
        case 'vp9Profile0':
          this.preferredVideoCodec = VideoCodecCapability.vp9Profile0();
          break;
        case 'vp9Profile1':
          this.preferredVideoCodec = VideoCodecCapability.vp9Profile1();
          break;
        case 'vp9Profile2':
          this.preferredVideoCodec = VideoCodecCapability.vp9Profile2();
          break;
        case 'av1MainProfile':
          this.preferredVideoCodec = VideoCodecCapability.av1MainProfile();
          break;
      }

      AsyncScheduler.nextTick(
        async (): Promise<void> => {
          let chimeMeetingId: string = '';
          this.showProgress('progress-authenticate');
          try {
            chimeMeetingId = await this.authenticate();
          } catch (error) {
            console.error(error);
            const httpErrorMessage =
              'UserMedia is not allowed in HTTP sites. Either use HTTPS or enable media capture on insecure sites.';
            (document.getElementById(
              'failed-meeting'
            ) as HTMLDivElement).innerText = `Meeting ID: ${this.meeting}`;
            (document.getElementById('failed-meeting-error') as HTMLDivElement).innerText =
              window.location.protocol === 'http:' ? httpErrorMessage : error.message;
            this.switchToFlow('flow-failed-meeting');
            return;
          }
          (document.getElementById(
            'meeting-id'
          ) as HTMLSpanElement).innerText = `${this.meeting} (${this.region})`;
          (document.getElementById(
            'chime-meeting-id'
          ) as HTMLSpanElement).innerText = `Meeting ID: ${chimeMeetingId}`;
          (document.getElementById(
            'mobile-chime-meeting-id'
          ) as HTMLSpanElement).innerText = `Meeting ID: ${chimeMeetingId}`;
          (document.getElementById(
            'mobile-attendee-id'
          ) as HTMLSpanElement).innerText = `Attendee ID: ${this.meetingSession.configuration.credentials.attendeeId}`;
          (document.getElementById(
            'desktop-attendee-id'
          ) as HTMLSpanElement).innerText = `Attendee ID: ${this.meetingSession.configuration.credentials.attendeeId}`;
          (document.getElementById('info-meeting') as HTMLSpanElement).innerText = this.meeting;
          (document.getElementById('info-name') as HTMLSpanElement).innerText = this.name;

          await this.initVoiceFocus();
          await this.initBackgroundBlur();
          await this.initBackgroundReplacement();
          await this.populateAllDeviceLists();
          await this.populateVideoFilterInputList(false);
          await this.populateVideoFilterInputList(true);
          if (this.enableSimulcast) {
            const videoInputQuality = document.getElementById(
              'video-input-quality'
            ) as HTMLSelectElement;
            videoInputQuality.value = '720p';
            this.audioVideo.chooseVideoInputQuality(1280, 720, 15, 1400);
          }

          this.switchToFlow('flow-devices');
          await this.openAudioInputFromSelectionAndPreview();
          try {
            await this.openVideoInputFromSelection(
              (document.getElementById('video-input') as HTMLSelectElement).value,
              true
            );
          } catch (err) {
            fatal(err);
          }
          await this.openAudioOutputFromSelection();
          this.hideProgress('progress-authenticate');

          // Open the signaling connection while the user is checking their input devices.
          const preconnect = document.getElementById('preconnect') as HTMLInputElement;
          if (preconnect.checked) {
            this.audioVideo.start({ signalingOnly: true });
          }
        }
      );
    });

    const earlyConnectCheckbox = document.getElementById('preconnect') as HTMLInputElement;
    earlyConnectCheckbox.checked = SHOULD_EARLY_CONNECT;
    earlyConnectCheckbox.onchange = () => {
      SHOULD_EARLY_CONNECT = !!earlyConnectCheckbox.checked;
    }

    const dieCheckbox = document.getElementById('die') as HTMLInputElement;
    dieCheckbox.checked = SHOULD_DIE_ON_FATALS;
    dieCheckbox.onchange = () => {
      SHOULD_DIE_ON_FATALS = !!dieCheckbox.checked;
    }

    const speechMonoCheckbox = document.getElementById(
      'fullband-speech-mono-quality'
    ) as HTMLInputElement;
    const musicMonoCheckbox = document.getElementById(
      'fullband-music-mono-quality'
    ) as HTMLInputElement;
    const musicStereoCheckbox = document.getElementById(
      'fullband-music-stereo-quality'
    ) as HTMLInputElement;
    speechMonoCheckbox.addEventListener('change', _e => {
      if (speechMonoCheckbox.checked) {
        musicMonoCheckbox.checked = false;
        musicStereoCheckbox.checked = false;
      }
    });
    musicMonoCheckbox.addEventListener('change', _e => {
      if (musicMonoCheckbox.checked) {
        speechMonoCheckbox.checked = false;
        musicStereoCheckbox.checked = false;
      }
    });
    musicStereoCheckbox.addEventListener('change', _e => {
      if (musicStereoCheckbox.checked) {
        speechMonoCheckbox.checked = false;
        musicMonoCheckbox.checked = false;
        this.usingStereoMusicAudioProfile = true;
      } else {
        this.usingStereoMusicAudioProfile = false;
      }
    });

    document.getElementById('to-sip-flow').addEventListener('click', e => {
      e.preventDefault();
      this.switchToFlow('flow-sip-authenticate');
    });

    document.getElementById('form-sip-authenticate').addEventListener('submit', e => {
      e.preventDefault();
      this.meeting = (document.getElementById('sip-inputMeeting') as HTMLInputElement).value;
      this.voiceConnectorId = (document.getElementById(
        'voiceConnectorId'
      ) as HTMLInputElement).value;

      AsyncScheduler.nextTick(
        async (): Promise<void> => {
          this.showProgress('progress-authenticate');
          const region = this.region || 'us-east-1';
          try {
            const response = await fetch(
              `${DemoMeetingApp.BASE_URL}join?title=${encodeURIComponent(
                this.meeting
              )}&name=${encodeURIComponent(DemoMeetingApp.DID)}&region=${encodeURIComponent(
                region
              )}`,
              {
                method: 'POST',
              }
            );
            const json = await response.json();
            const joinToken = json.JoinInfo.Attendee.Attendee.JoinToken;
            this.sipURI = `sip:${DemoMeetingApp.DID}@${this.voiceConnectorId};transport=tls;X-joinToken=${joinToken}`;
            this.switchToFlow('flow-sip-uri');
          } catch (error) {
            (document.getElementById(
              'failed-meeting'
            ) as HTMLDivElement).innerText = `Meeting ID: ${this.meeting}`;
            (document.getElementById('failed-meeting-error') as HTMLDivElement).innerText =
              error.message;
            this.switchToFlow('flow-failed-meeting');
            return;
          }
          const sipUriElement = document.getElementById('sip-uri') as HTMLInputElement;
          sipUriElement.value = this.sipURI;
          this.hideProgress('progress-authenticate');
        }
      );
    });

    if(!this.areVideoFiltersSupported())  {
      document.getElementById('video-input-filter-container').style.display = 'none';
    }

    let videoInputFilter = document.getElementById('video-input-filter') as HTMLInputElement;
    videoInputFilter.addEventListener('change', async () => {
      this.selectedVideoFilterItem = <VideoFilterName>videoInputFilter.value;
      this.log(`Clicking video filter: ${this.selectedVideoFilterItem}`);
      await this.openVideoInputFromSelection(this.selectedVideoInput, true)
    });

    document.getElementById('copy-sip-uri').addEventListener('click', () => {
      const sipUriElement = document.getElementById('sip-uri') as HTMLInputElement;
      sipUriElement.select();
      document.execCommand('copy');
    });

    const audioInput = document.getElementById('audio-input') as HTMLSelectElement;
    audioInput.addEventListener('change', async (_ev: Event) => {
      this.log('audio input device is changed');
      await this.openAudioInputFromSelectionAndPreview();
    });

    const videoInput = document.getElementById('video-input') as HTMLSelectElement;
    videoInput.addEventListener('change', async (_ev: Event) => {
      this.log('video input device is changed');
      try {
        await this.openVideoInputFromSelection(videoInput.value, true);
      } catch (err) {
        fatal(err);
      }
    });

    const videoInputQuality = document.getElementById('video-input-quality') as HTMLSelectElement;
    videoInputQuality.addEventListener('change', async (_ev: Event) => {
      this.log('Video input quality is changed');
      switch (videoInputQuality.value) {
        case '360p':
          this.audioVideo.chooseVideoInputQuality(640, 360, 15, 600);
          break;
        case '540p':
          this.audioVideo.chooseVideoInputQuality(960, 540, 15, 1400);
          break;
        case '720p':
          this.audioVideo.chooseVideoInputQuality(1280, 720, 15, 1400);
          break;
      }
      try {
        if (this.chosenVideoTransformDevice) {
          await this.chosenVideoTransformDevice.stop();
          this.chosenVideoTransformDevice = null;
        }
        await this.openVideoInputFromSelection(videoInput.value, true);
      } catch (err) {
        fatal(err);
      }
    });

    const audioOutput = document.getElementById('audio-output') as HTMLSelectElement;
    audioOutput.addEventListener('change', async (_ev: Event) => {
      this.log('audio output device is changed');
      await this.openAudioOutputFromSelection();
    });

    document.getElementById('button-test-sound').addEventListener('click', async e => {
      e.preventDefault();
      const audioOutput = document.getElementById('audio-output') as HTMLSelectElement;
      const testSound = new TestSound(this.meetingEventPOSTLogger, audioOutput.value);
      await testSound.init();
    });

    document.getElementById('form-devices').addEventListener('submit', e => {
      e.preventDefault();
      AsyncScheduler.nextTick(async () => {
        try {
          this.showProgress('progress-join');
          await this.stopAudioPreview();
          this.audioVideo.stopVideoPreviewForVideoInput(
            document.getElementById('video-preview') as HTMLVideoElement
          );
          // stopVideoProcessor should be called before join; it ensures that state variables and video processor stream are cleaned / removed before joining the meeting.
          // If stopVideoProcessor is not called then the state from preview screen will be carried into the in meeting experience and it will cause undesired side effects.
          await this.stopVideoProcessor();
          await this.join();
          this.hideProgress('progress-join');
          this.displayButtonStates();
          this.switchToFlow('flow-meeting');

          if (DEBUG_LOG_PPS) {
            this.logPPS();
            DEBUG_LOG_PPS = false;   // Only do this once.
          }
        } catch (error) {
          document.getElementById('failed-join').innerText = `Meeting ID: ${this.meeting}`;
          document.getElementById('failed-join-error').innerText = `Error: ${error.message}`;
        }
      });
    });

    (document.getElementById('add-voice-focus') as HTMLInputElement).addEventListener(
      'change',
      e => {
        this.enableVoiceFocus = (e.target as HTMLInputElement).checked;
        this.onVoiceFocusSettingChanged();
      }
    );

    const buttonMute = document.getElementById('button-microphone');
    buttonMute.addEventListener('click', _e => {
      if (this.toggleButton('button-microphone')) {
        this.audioVideo.realtimeUnmuteLocalAudio();
      } else {
        this.audioVideo.realtimeMuteLocalAudio();
      }
    });

    const buttonCloudCapture = document.getElementById('button-record-cloud') as HTMLButtonElement;
    buttonCloudCapture.addEventListener('click', _e => {
      if (this.toggleButton('button-record-cloud')) {
        AsyncScheduler.nextTick(async () => {
          buttonCloudCapture.disabled = true;
          await this.startMediaCapture();
          buttonCloudCapture.disabled = false;
        });
      } else {
        AsyncScheduler.nextTick(async () => {
          buttonCloudCapture.disabled = true;
          await this.stopMediaCapture();
          buttonCloudCapture.disabled = false;
        });
      }
    });

    const buttonRecordSelf = document.getElementById('button-record-self');
    let recorder: MediaRecorder;
    buttonRecordSelf.addEventListener('click', _e => {
      const chunks: Blob[] = [];
      AsyncScheduler.nextTick(async () => {
        if (!this.toggleButton('button-record-self')) {
          console.info('Stopping recorder ', recorder);
          recorder.stop();
          recorder = undefined;
          return;
        }

        // Combine the audio and video streams.
        const mixed = new MediaStream();

        const localTile = this.audioVideo.getLocalVideoTile();
        if (localTile) {
          mixed.addTrack(localTile.state().boundVideoStream.getVideoTracks()[0]);
        }

        // We need to get access to the media stream broker, which requires knowing
        // the exact implementation. Sorry!
        /* @ts-ignore */
        const av: DefaultAudioVideoController = this.audioVideo.audioVideoController;
        const input = await av.mediaStreamBroker.acquireAudioInputStream();
        mixed.addTrack(input.getAudioTracks()[0]);

        recorder = new MediaRecorder(mixed, { mimeType: 'video/webm; codecs=vp9' });
        console.info('Setting recorder to', recorder);
        recorder.ondataavailable = (event) => {
          if (event.data.size) {
            chunks.push(event.data);
          }
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, {
            type: 'video/webm',
          });
          chunks.length = 0;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          document.body.appendChild(a);
          /* @ts-ignore */
          a.style = 'display: none';
          a.href = url;
          a.download = 'recording.webm';
          a.click();
          window.URL.revokeObjectURL(url);
        };

        recorder.start();
      });
    });

    const buttonVideo = document.getElementById('button-camera');
    buttonVideo.addEventListener('click', _e => {
      AsyncScheduler.nextTick(async () => {
        if (this.toggleButton('button-camera') && this.canStartLocalVideo) {
          try {
            let camera: string | null = this.selectedVideoInput;
            if (camera === null || camera === 'None') {
              camera = this.cameraDeviceIds.length ? this.cameraDeviceIds[0] : 'None';
            }
            await this.openVideoInputFromSelection(camera, false);
            this.audioVideo.startLocalVideoTile();
          } catch (err) {
            fatal(err);
          }
        } else {
          this.audioVideo.stopLocalVideoTile();
          // Tile will be removed in response to `videoTileWasRemoved` in `VideoTileCollection`
        }
      });
    });

    const buttonPauseContentShare = document.getElementById('button-pause-content-share');
    buttonPauseContentShare.addEventListener('click', _e => {
      if (!this.isButtonOn('button-content-share')) {
        return;
      }
      AsyncScheduler.nextTick(async () => {
        if (this.toggleButton('button-pause-content-share')) {
          this.audioVideo.pauseContentShare();
          if (this.contentShareType === ContentShareType.VideoFile) {
            const videoFile = document.getElementById('content-share-video') as HTMLVideoElement;
            videoFile.pause();
          }
        } else {
          this.audioVideo.unpauseContentShare();
          if (this.contentShareType === ContentShareType.VideoFile) {
            const videoFile = document.getElementById('content-share-video') as HTMLVideoElement;
            await videoFile.play();
          }
        }
      });
    });

    const buttonContentShare = document.getElementById('button-content-share');
    buttonContentShare.addEventListener('click', _e => {
      AsyncScheduler.nextTick(() => {
        if (!this.isButtonOn('button-content-share')) {
          this.contentShareStart();
        } else {
          this.contentShareStop();
        }
      });
    });

    const buttonSpeaker = document.getElementById('button-speaker');
    buttonSpeaker.addEventListener('click', _e => {
      AsyncScheduler.nextTick(async () => {
        if (this.toggleButton('button-speaker')) {
          try {
            await this.audioVideo.bindAudioElement(
              document.getElementById('meeting-audio') as HTMLAudioElement
            );
          } catch (e) {
            fatal(e);
            this.log('Failed to bindAudioElement', e);
          }
        } else {
          this.audioVideo.unbindAudioElement();
        }
      });
    });

    const buttonLiveTranscription = document.getElementById('button-live-transcription');
    buttonLiveTranscription.addEventListener('click', () => {
      this.transcriptContainerDiv.style.display = this.isButtonOn('button-live-transcription') ? 'none' : 'block';
      this.toggleButton('button-live-transcription');
    });

    const buttonLiveTranscriptionModal = document.getElementById('button-live-transcription-modal-close');
    buttonLiveTranscriptionModal.addEventListener('click', () => {
      document.getElementById('live-transcription-modal').style.display = 'none';
    });

    // show only languages available to selected transcription engine
    document.getElementsByName('transcription-engine').forEach(e => {
      e.addEventListener('change', () => {
        const engineTranscribeChecked = (document.getElementById('engine-transcribe') as HTMLInputElement).checked;
        const contentIdentificationChecked = (document.getElementById('content-identification-checkbox') as HTMLInputElement).checked;
        const contentRedactionChecked = (document.getElementById('content-redaction-checkbox') as HTMLInputElement).checked;
        document.getElementById('engine-transcribe-language').classList.toggle('hidden', !engineTranscribeChecked);
		    document.getElementById('engine-transcribe-medical-language').classList.toggle('hidden', engineTranscribeChecked);
        document.getElementById('engine-transcribe-region').classList.toggle('hidden', !engineTranscribeChecked);
        document.getElementById('engine-transcribe-medical-region').classList.toggle('hidden', engineTranscribeChecked);
        document.getElementById('engine-transcribe-medical-content-identification').classList.toggle('hidden', engineTranscribeChecked);
        document.getElementById('engine-transcribe-content-identification').classList.toggle('hidden', !engineTranscribeChecked);
        document.getElementById('engine-transcribe-redaction').classList.toggle('hidden', !engineTranscribeChecked);
        document.getElementById('engine-transcribe-partial-stabilization').classList.toggle('hidden', !engineTranscribeChecked);
        document.getElementById('engine-transcribe-custom-language-model').classList.toggle('hidden', !engineTranscribeChecked);
        if (!engineTranscribeChecked) {
          document.getElementById('transcribe-entity-types').classList.toggle('hidden', true);
        } else if (engineTranscribeChecked && (contentIdentificationChecked || contentRedactionChecked)) {
          document.getElementById('transcribe-entity-types').classList.toggle('hidden', false);
        }
      });
    });

    const contentIdentificationCb = document.getElementById('content-identification-checkbox') as HTMLInputElement;
    contentIdentificationCb.addEventListener('click', () => {
      (document.getElementById('content-redaction-checkbox') as HTMLInputElement).disabled = contentIdentificationCb.checked;
      (document.getElementById('transcribe-entity-types') as HTMLInputElement).classList.toggle('hidden', !contentIdentificationCb.checked);
    });

    const contentRedactionCb = document.getElementById('content-redaction-checkbox') as HTMLInputElement;
    contentRedactionCb.addEventListener('click', () => {
      (document.getElementById('content-identification-checkbox') as HTMLInputElement).disabled = contentRedactionCb.checked;
      (document.getElementById('transcribe-entity-types') as HTMLInputElement).classList.toggle('hidden', !contentRedactionCb.checked);
    });

    const partialResultsStabilityCb = document.getElementById('partial-stabilization-checkbox') as HTMLInputElement;
    partialResultsStabilityCb.addEventListener('click', () => {
      (document.getElementById('transcribe-partial-stability').classList.toggle('hidden', !partialResultsStabilityCb.checked));
    });

    const languageModelCb = document.getElementById('custom-language-model-checkbox') as HTMLInputElement;
    languageModelCb.addEventListener('click', () => {
      (document.getElementById('language-model').classList.toggle('hidden', !languageModelCb.checked));
    });

    const buttonStartTranscription = document.getElementById('button-start-transcription');
    buttonStartTranscription.addEventListener('click', async () => {
      let engine = '';
      let languageCode = '';
      let region = '';
      const transcriptionStreamParams: TranscriptionStreamParams = {};
      if ((document.getElementById('engine-transcribe') as HTMLInputElement).checked) {
        engine = 'transcribe';
        languageCode = (document.getElementById('transcribe-language') as HTMLInputElement).value;
        region = (document.getElementById('transcribe-region') as HTMLInputElement).value;

        if (isChecked('content-identification-checkbox')) {
          transcriptionStreamParams.contentIdentificationType = 'PII';
        }

        if (isChecked('content-redaction-checkbox')) {
          transcriptionStreamParams.contentRedactionType = 'PII';
        }

        if (isChecked('partial-stabilization-checkbox')) {
          transcriptionStreamParams.enablePartialResultsStability = true;
        }

        let partialResultsStability = (document.getElementById('partial-stability') as HTMLInputElement).value;
        if (partialResultsStability) {
          transcriptionStreamParams.partialResultsStability = partialResultsStability;
        }
        if (isChecked('content-identification-checkbox') || isChecked('content-redaction-checkbox')) {
          const selected = document.querySelectorAll('#transcribe-entity option:checked');
          let values = '';
          if (selected.length > 0) {
            values = Array.from(selected).filter(node => (node as HTMLInputElement).value !== '').map(el => (el as HTMLInputElement).value).join(',');
          }
          if (values !== '') {
            transcriptionStreamParams.piiEntityTypes = values;
          }
        }

        if (isChecked('custom-language-model-checkbox')) {
          let languageModelName = (document.getElementById('language-model-input-text') as HTMLInputElement).value;
          if (languageModelName) {
            transcriptionStreamParams.languageModelName = languageModelName;
          }
        }
      } else if ((document.getElementById('engine-transcribe-medical') as HTMLInputElement).checked) {
        engine = 'transcribe_medical';
        languageCode = (document.getElementById('transcribe-medical-language') as HTMLInputElement).value;
        region = (document.getElementById('transcribe-medical-region') as HTMLInputElement).value;
        if (isChecked('medical-content-identification-checkbox')) {
          transcriptionStreamParams.contentIdentificationType = 'PHI';
        }
      } else {
        throw new Error('Unknown transcription engine');
      }
      await startLiveTranscription(engine, languageCode, region, transcriptionStreamParams);
    });

    function isChecked(id: string): boolean {
      return (document.getElementById(id) as HTMLInputElement).checked;
    }

    const startLiveTranscription = async (engine: string, languageCode: string, region: string, transcriptionStreamParams: TranscriptionStreamParams) => {
      const transcriptionAdditionalParams = JSON.stringify(transcriptionStreamParams);
      const response = await fetch(`${DemoMeetingApp.BASE_URL}start_transcription?title=${encodeURIComponent(this.meeting)}&engine=${encodeURIComponent(engine)}&language=${encodeURIComponent(languageCode)}&region=${encodeURIComponent(region)}&transcriptionStreamParams=${encodeURIComponent(transcriptionAdditionalParams)}`, {
        method: 'POST',
      });
      const json = await response.json();
      if (json.error) {
        throw new Error(`Server error: ${json.error}`);
      }
      document.getElementById('live-transcription-modal').style.display = 'none';
    };

    const buttonVideoStats = document.getElementById('button-video-stats');
    buttonVideoStats.addEventListener('click', () => {
      if (this.isButtonOn('button-video-stats')) {
        document.querySelectorAll('.stats-info').forEach(e => e.remove());
      } else {
        this.getRelayProtocol();
      }
      this.toggleButton('button-video-stats');
    });

    const sendMessage = (): void => {
      AsyncScheduler.nextTick(() => {
        const textArea = document.getElementById('send-message') as HTMLTextAreaElement;
        const textToSend = textArea.value.trim();
        if (!textToSend) {
          return;
        }
        textArea.value = '';
        this.audioVideo.realtimeSendDataMessage(
          DemoMeetingApp.DATA_MESSAGE_TOPIC,
          textToSend,
          DemoMeetingApp.DATA_MESSAGE_LIFETIME_MS
        );
        // echo the message to the handler
        this.dataMessageHandler(
          new DataMessage(
            Date.now(),
            DemoMeetingApp.DATA_MESSAGE_TOPIC,
            new TextEncoder().encode(textToSend),
            this.meetingSession.configuration.credentials.attendeeId,
            this.meetingSession.configuration.credentials.externalUserId
          )
        );
      });
    };

    const textAreaSendMessage = document.getElementById('send-message') as HTMLTextAreaElement;
    textAreaSendMessage.addEventListener('keydown', e => {
      if (e.keyCode === 13) {
        if (e.shiftKey) {
          textAreaSendMessage.rows++;
        } else {
          e.preventDefault();
          sendMessage();
          textAreaSendMessage.rows = 1;
        }
      }
    });

    const buttonMeetingEnd = document.getElementById('button-meeting-end');
    buttonMeetingEnd.addEventListener('click', _e => {
      const confirmEnd = new URL(window.location.href).searchParams.get('confirm-end') === 'true';
      const prompt =
        'Are you sure you want to end the meeting for everyone? The meeting cannot be used after ending it.';
      if (confirmEnd && !window.confirm(prompt)) {
        return;
      }
      AsyncScheduler.nextTick(async () => {
        (buttonMeetingEnd as HTMLButtonElement).disabled = true;
        await this.endMeeting();
        await this.leave();
        (buttonMeetingEnd as HTMLButtonElement).disabled = false;
      });
    });

    const buttonMeetingLeave = document.getElementById('button-meeting-leave');
    buttonMeetingLeave.addEventListener('click', e => {
      if (e.shiftKey) {
        this.behaviorAfterLeave = 'halt';
      };
      AsyncScheduler.nextTick(async () => {
        (buttonMeetingLeave as HTMLButtonElement).disabled = true;
        await this.leave();
        (buttonMeetingLeave as HTMLButtonElement).disabled = false;
      });
    });
  }

  logPPS() {
    let start = 0;
    let packets = 0;
    setInterval(async () => {
      if (!this.audioVideo) {
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stats = await this.audioVideo.getRTCPeerConnectionStats() as RTCStatsReport & RTCStats & Map<string, any>;

      if (!stats) {
        return;
      }

      if (!start) {
        start = Date.now();
        return;
      }

      for (const [_, entry] of stats.entries()) {
        if (entry.type === 'outbound-rtp') {
          const now = Date.now();
          const deltat = now - start;
          const deltap = entry.packetsSent - packets;
          const pps = (1000 * deltap) / deltat;

          let overage = 0;
          if ((pps > 52) || (pps < 47)) {
            console.error('PPS:', pps, `(${++overage})`);
          } else {
            overage = 0;
            console.debug('PPS:', pps);
          }
          start = now;
          packets = entry.packetsSent;
          return;
        }
      }
    }, 1_000);
  }

  getSupportedMediaRegions(): string[] {
    const supportedMediaRegions: string[] = [];
    const mediaRegion = document.getElementById('inputRegion') as HTMLSelectElement;
    for (let i = 0; i < mediaRegion.length; i++) {
      supportedMediaRegions.push(mediaRegion.value);
    }
    return supportedMediaRegions;
  }

  async getNearestMediaRegion(): Promise<string> {
    const nearestMediaRegionResponse = await fetch(`https://nearest-media-region.l.chime.aws`, {
      method: 'GET',
    });
    const nearestMediaRegionJSON = await nearestMediaRegionResponse.json();
    const nearestMediaRegion = nearestMediaRegionJSON.region;
    return nearestMediaRegion;
  }

  setMediaRegion(): void {
    AsyncScheduler.nextTick(
      async (): Promise<void> => {
        try {
          const query = new URLSearchParams(document.location.search);
          const region = query.get('region');
          const nearestMediaRegion = region ? region : await this.getNearestMediaRegion();
          if (nearestMediaRegion === '' || nearestMediaRegion === null) {
            throw new Error('Nearest Media Region cannot be null or empty');
          }
          const supportedMediaRegions: string[] = this.getSupportedMediaRegions();
          if (supportedMediaRegions.indexOf(nearestMediaRegion) === -1) {
            supportedMediaRegions.push(nearestMediaRegion);
            const mediaRegionElement = document.getElementById('inputRegion') as HTMLSelectElement;
            const newMediaRegionOption = document.createElement('option');
            newMediaRegionOption.value = nearestMediaRegion;
            newMediaRegionOption.text = nearestMediaRegion + ' (' + nearestMediaRegion + ')';
            mediaRegionElement.add(newMediaRegionOption, null);
          }
          (document.getElementById('inputRegion') as HTMLInputElement).value = nearestMediaRegion;
        } catch (error) {
          fatal(error);
          this.log('Default media region selected: ' + error.message);
        }
      }
    );
  }

  setButtonVisibility(button: string, visible: boolean, state?: 'on' | 'off') {
    const element = document.getElementById(button);
    element.style.display = visible ? 'inline-block' : 'none';
    this.toggleButton(button, state);
  }

  toggleButton(button: string, state?: 'on' | 'off'): boolean {
    if (state === 'on') {
      this.buttonStates[button] = true;
    } else if (state === 'off') {
      this.buttonStates[button] = false;
    } else {
      this.buttonStates[button] = !this.buttonStates[button];
    }
    this.displayButtonStates();
    return this.buttonStates[button];
  }

  isButtonOn(button: string): boolean {
    return this.buttonStates[button];
  }

  displayButtonStates(): void {
    for (const button in this.buttonStates) {
      const element = document.getElementById(button);
      const drop = document.getElementById(`${button}-drop`);
      const on = this.buttonStates[button];
      element.classList.add(on ? 'btn-success' : 'btn-outline-secondary');
      element.classList.remove(on ? 'btn-outline-secondary' : 'btn-success');
      (element.firstElementChild as SVGElement).classList.add(on ? 'svg-active' : 'svg-inactive');
      (element.firstElementChild as SVGElement).classList.remove(
        on ? 'svg-inactive' : 'svg-active'
      );
      if (drop) {
        drop.classList.add(on ? 'btn-success' : 'btn-outline-secondary');
        drop.classList.remove(on ? 'btn-outline-secondary' : 'btn-success');
      }
    }
  }

  showProgress(id: string): void {
    (document.getElementById(id) as HTMLDivElement).style.visibility = 'visible';
  }

  hideProgress(id: string): void {
    (document.getElementById(id) as HTMLDivElement).style.visibility = 'hidden';
  }

  switchToFlow(flow: string): void {
    Array.from(document.getElementsByClassName('flow')).map(
      e => ((e as HTMLDivElement).style.display = 'none')
    );
    (document.getElementById(flow) as HTMLDivElement).style.display = 'block';
  }

  async onAudioInputsChanged(freshDevices: MediaDeviceInfo[]): Promise<void> {
    await this.populateAudioInputList();

    if (!this.currentAudioInputDevice) {
      return;
    }

    if (this.currentAudioInputDevice === 'default') {
      // The default device might actually have changed. Go ahead and trigger a
      // reselection.
      this.log('Reselecting default device.');
      await this.selectAudioInputDevice(this.currentAudioInputDevice);
      return;
    }

    const freshDeviceWithSameID = freshDevices.find(
      device => device.deviceId === this.currentAudioInputDevice
    );

    if (freshDeviceWithSameID === undefined) {
      this.log('Existing device disappeared. Selecting a new one.');

      // Select a new device.
      await this.openAudioInputFromSelectionAndPreview();
    }
  }

  audioInputMuteStateChanged(device: string | MediaStream, muted: boolean): void {
    this.log('Mute state: device', device, muted ? 'is muted' : 'is not muted');
  }

  audioInputsChanged(freshAudioInputDeviceList: MediaDeviceInfo[]): void {
    this.onAudioInputsChanged(freshAudioInputDeviceList);
  }

  videoInputsChanged(_freshVideoInputDeviceList: MediaDeviceInfo[]): void {
    this.populateVideoInputList();
  }

  audioOutputsChanged(_freshAudioOutputDeviceList: MediaDeviceInfo[]): void {
    this.populateAudioOutputList();
  }

  audioInputStreamEnded(deviceId: string): void {
    this.log(`Current audio input stream from device id ${deviceId} ended.`);
  }

  videoInputStreamEnded(deviceId: string): void {
    this.log(`Current video input stream from device id ${deviceId} ended.`);
  }

  estimatedDownlinkBandwidthLessThanRequired(
    estimatedDownlinkBandwidthKbps: number,
    requiredVideoDownlinkBandwidthKbps: number
  ): void {
    this.log(
      `Estimated downlink bandwidth is ${estimatedDownlinkBandwidthKbps} is less than required bandwidth for video ${requiredVideoDownlinkBandwidthKbps}`
    );
  }

  videoNotReceivingEnoughData(videoReceivingReports: ClientVideoStreamReceivingReport[]): void {
    this.log(
      `One or more video streams are not receiving expected amounts of data ${JSON.stringify(
        videoReceivingReports
      )}`
    );
  }

  metricsDidReceive(clientMetricReport: ClientMetricReport): void {
    const metricReport = clientMetricReport.getObservableMetrics();
    this.videoMetricReport = clientMetricReport.getObservableVideoMetrics();

    this.displayEstimatedUplinkBandwidth(
      metricReport.availableSendBandwidth
        ? metricReport.availableSendBandwidth
        : metricReport.availableOutgoingBitrate
    );
    this.displayEstimatedDownlinkBandwidth(
      metricReport.availableReceiveBandwidth
        ? metricReport.availableReceiveBandwidth
        : metricReport.availableIncomingBitrate
    );

    this.isButtonOn('button-video-stats') && this.videoTileCollection.showVideoWebRTCStats(this.videoMetricReport);
  }

  displayEstimatedUplinkBandwidth(bitrate: number) {
    const value = `Available Uplink Bandwidth: ${bitrate ? bitrate / 1000 : 'Unknown'} Kbps`;
    (document.getElementById('video-uplink-bandwidth') as HTMLSpanElement).innerText = value;
    (document.getElementById('mobile-video-uplink-bandwidth') as HTMLSpanElement).innerText = value;
  }

  displayEstimatedDownlinkBandwidth(bitrate: number) {
    const value = `Available Downlink Bandwidth: ${bitrate ? bitrate / 1000 : 'Unknown'} Kbps`;
    (document.getElementById('video-downlink-bandwidth') as HTMLSpanElement).innerText = value;
    (document.getElementById('mobile-video-downlink-bandwidth') as HTMLSpanElement).innerText = value;
  }

  resetStats = (): void => {
    this.videoMetricReport = {};
  };

  async getRelayProtocol(): Promise<void> {
    const rawStats = await this.audioVideo.getRTCPeerConnectionStats();
    if (rawStats) {
      rawStats.forEach(report => {
        if (report.type === 'local-candidate') {
          this.log(`Local WebRTC Ice Candidate stats: ${JSON.stringify(report)}`);
          const relayProtocol = report.relayProtocol;
          if (typeof relayProtocol === 'string') {
            if (relayProtocol === 'udp') {
              this.log(`Connection using ${relayProtocol.toUpperCase()} protocol`);
            } else {
              this.log(`Connection fell back to ${relayProtocol.toUpperCase()} protocol`);
            }
          }
        }
      });
    }
  }

  async createLogStream(
    configuration: MeetingSessionConfiguration,
    pathname: string
  ): Promise<void> {
    const body = JSON.stringify({
      meetingId: configuration.meetingId,
      attendeeId: configuration.credentials.attendeeId,
    });
    try {
      const response = await fetch(`${DemoMeetingApp.BASE_URL}${pathname}`, {
        method: 'POST',
        body,
      });
      if (response.status === 200) {
        console.log('[DEMO] log stream created');
      }
    } catch (error) {
      fatal(error);
      this.log(error.message);
    }
  }

  eventDidReceive(name: EventName, attributes: EventAttributes): void {
    this.log(`Received an event: ${JSON.stringify({ name, attributes })}`);
    const { meetingHistory, ...otherAttributes } = attributes;
    switch (name) {
      case 'meetingStartRequested':
      case 'meetingStartSucceeded':
      case 'meetingEnded':
      case 'audioInputSelected':
      case 'videoInputSelected':
      case 'audioInputUnselected':
      case 'videoInputUnselected':
      case 'meetingReconnected':
      case 'receivingAudioDropped':
      case 'signalingDropped':
      case 'attendeePresenceReceived': {
        // Exclude the "meetingHistory" attribute for successful -> published events.
        this.meetingEventPOSTLogger?.info(
          JSON.stringify({
            name,
            attributes: otherAttributes,
          })
        );
        break;
      }
      case 'audioInputFailed':
      case 'videoInputFailed':
      case 'meetingStartFailed':
      case 'meetingFailed': {
        // Send the last 5 minutes of events.
        this.meetingEventPOSTLogger?.info(
          JSON.stringify({
            name,
            attributes: {
              ...otherAttributes,
              meetingHistory: meetingHistory.filter(({ timestampMs }) => {
                return Date.now() - timestampMs < DemoMeetingApp.MAX_MEETING_HISTORY_MS;
              }),
            },
          })
        );
        break;
      }
    }
  }

  async initializeMeetingSession(configuration: MeetingSessionConfiguration): Promise<void> {
    const consoleLogger = (this.meetingLogger = new ConsoleLogger('SDK', this.logLevel));
    if (this.isLocalHost()) {
      this.meetingLogger = consoleLogger;
    } else {
      await Promise.all([
        this.createLogStream(configuration, 'create_log_stream'),
        this.createLogStream(configuration, 'create_browser_event_log_stream'),
      ]);
      this.meetingSessionPOSTLogger = new MeetingSessionPOSTLogger(
        'SDK',
        configuration,
        DemoMeetingApp.LOGGER_BATCH_SIZE,
        DemoMeetingApp.LOGGER_INTERVAL_MS,
        `${DemoMeetingApp.BASE_URL}logs`,
        this.logLevel
      );
      this.meetingLogger = new MultiLogger(
        consoleLogger,
        this.meetingSessionPOSTLogger,
      );
      this.meetingEventPOSTLogger = new MeetingSessionPOSTLogger(
        'SDKEvent',
        configuration,
        DemoMeetingApp.LOGGER_BATCH_SIZE,
        DemoMeetingApp.LOGGER_INTERVAL_MS,
        `${DemoMeetingApp.BASE_URL}log_meeting_event`,
        this.logLevel
      );
    }
    this.eventReporter = await this.setupEventReporter(configuration);
    const deviceController = new DefaultDeviceController(this.meetingLogger, {
      enableWebAudio: this.enableWebAudio,
    });
    const urlParameters = new URL(window.location.href).searchParams;
    const timeoutMs = Number(urlParameters.get('attendee-presence-timeout-ms'));
    if (!isNaN(timeoutMs)) {
      configuration.attendeePresenceTimeoutMs = Number(timeoutMs);
    }
    if (this.usePriorityBasedDownlinkPolicy) {
      this.priorityBasedDownlinkPolicy = new VideoPriorityBasedPolicy(this.meetingLogger, this.videoPriorityBasedPolicyConfig);
      configuration.videoDownlinkBandwidthPolicy = this.priorityBasedDownlinkPolicy;
      this.priorityBasedDownlinkPolicy.addObserver(this);
    }

    // Always set the uplink policy, in case we need to set codec preferences
    if (this.enableSimulcast) {
        configuration.enableSimulcastForUnifiedPlanChromiumBasedBrowsers = true;
        configuration.videoUplinkBandwidthPolicy = new DefaultSimulcastUplinkPolicy(
            configuration.credentials.attendeeId,
            this.meetingLogger
        );
    } else {
        configuration.videoUplinkBandwidthPolicy = new NScaleVideoUplinkBandwidthPolicy(
            configuration.credentials.attendeeId,
            this.defaultBrowserBehaviour.disableResolutionScaleDown(),
            this.meetingLogger
        );
    }
    configuration.videoUplinkBandwidthPolicy.setVideoCodecPreferences([this.preferredVideoCodec]);
    configuration.applicationMetadata = ApplicationMetadata.create('amazon-chime-sdk-js-demo', '2.0.0');

    if ((document.getElementById('pause-last-frame') as HTMLInputElement).checked) {
      configuration.keepLastFrameWhenPaused = true;
    }

    this.meetingSession = new DefaultMeetingSession(
      configuration,
      this.meetingLogger,
      deviceController,
      this.eventReporter
    );

    if ((document.getElementById('fullband-speech-mono-quality') as HTMLInputElement).checked) {
      this.meetingSession.audioVideo.setAudioProfile(AudioProfile.fullbandSpeechMono());
      this.meetingSession.audioVideo.setContentAudioProfile(AudioProfile.fullbandSpeechMono());
      this.log('Using audio profile fullband-speech-mono-quality');
    } else if (
      (document.getElementById('fullband-music-mono-quality') as HTMLInputElement).checked
    ) {
      this.meetingSession.audioVideo.setAudioProfile(AudioProfile.fullbandMusicMono());
      this.meetingSession.audioVideo.setContentAudioProfile(AudioProfile.fullbandMusicMono());
      this.log('Using audio profile fullband-music-mono-quality');
    } else if (
      (document.getElementById('fullband-music-stereo-quality') as HTMLInputElement).checked
    ) {
      this.meetingSession.audioVideo.setAudioProfile(AudioProfile.fullbandMusicStereo());
      this.meetingSession.audioVideo.setContentAudioProfile(AudioProfile.fullbandMusicStereo());
      this.log('Using audio profile fullband-music-stereo-quality');
    }
    this.audioVideo = this.meetingSession.audioVideo;
    this.audioVideo.addDeviceChangeObserver(this);
    this.setupDeviceLabelTrigger();
    this.setupMuteHandler();
    this.setupCanUnmuteHandler();
    this.setupSubscribeToAttendeeIdPresenceHandler();
    this.setupDataMessage();
    this.setupLiveTranscription();
    this.audioVideo.addObserver(this);
    this.audioVideo.addContentShareObserver(this);

    this.videoTileCollection = new VideoTileCollection(this.audioVideo,
        this.meetingLogger,
        this.usePriorityBasedDownlinkPolicy ? new VideoPreferenceManager(this.meetingLogger, this.priorityBasedDownlinkPolicy) : undefined,
        (document.getElementById('enable-pagination') as HTMLInputElement).checked ? DemoMeetingApp.REDUCED_REMOTE_VIDEO_PAGE_SIZE : DemoMeetingApp.REMOTE_VIDEO_PAGE_SIZE)
    this.audioVideo.addObserver(this.videoTileCollection);

    this.initContentShareDropDownItems();
  }

  async setupEventReporter(configuration: MeetingSessionConfiguration): Promise<EventReporter> {
    let eventReporter: EventReporter;
    const ingestionURL = configuration.urls.eventIngestionURL;
    if (!ingestionURL) {
      return eventReporter;
    }
    if (!this.enableEventReporting) {
      return new NoOpEventReporter();
    }
    const eventReportingLogger = new ConsoleLogger('SDKEventIngestion', LogLevel.INFO);
    const meetingEventClientConfig = new MeetingEventsClientConfiguration(
      configuration.meetingId,
      configuration.credentials.attendeeId,
      configuration.credentials.joinToken
    );
    const eventIngestionConfiguration = new EventIngestionConfiguration(
      meetingEventClientConfig,
      ingestionURL
    );
    if (this.isLocalHost()) {
      eventReporter = new DefaultMeetingEventReporter(eventIngestionConfiguration, eventReportingLogger);
    } else {
      await this.createLogStream(configuration, 'create_browser_event_ingestion_log_stream');
      const eventReportingPOSTLogger = new MeetingSessionPOSTLogger(
        'SDKEventIngestion',
        configuration,
        DemoMeetingApp.LOGGER_BATCH_SIZE,
        DemoMeetingApp.LOGGER_INTERVAL_MS,
        `${DemoMeetingApp.BASE_URL}log_event_ingestion`,
        LogLevel.DEBUG
      );
      const multiEventReportingLogger = new MultiLogger(
        eventReportingLogger,
        eventReportingPOSTLogger,
      );
      eventReporter = new DefaultMeetingEventReporter(eventIngestionConfiguration, multiEventReportingLogger);
    }
    return eventReporter;
  }

  private isLocalHost(): boolean {
    return document.location.host === '127.0.0.1:8080' || document.location.host === 'localhost:8080';
  }

  async join(): Promise<void> {
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      this.log(event.reason);
    });
    this.audioVideo.start();
  }

  async leave(): Promise<void> {
    this.resetStats();
    this.audioVideo.stop();
    await this.voiceFocusDevice?.stop();
    this.voiceFocusDevice = undefined;

    await this.chosenVideoTransformDevice?.stop();
    this.chosenVideoTransformDevice = undefined;
    this.roster = {};
  }

  setupMuteHandler(): void {
    const handler = (isMuted: boolean): void => {
      this.log(`muted = ${isMuted}`);
    };
    this.audioVideo.realtimeSubscribeToMuteAndUnmuteLocalAudio(handler);
    const isMuted = this.audioVideo.realtimeIsLocalAudioMuted();
    handler(isMuted);
  }

  setupCanUnmuteHandler(): void {
    const handler = (canUnmute: boolean): void => {
      this.log(`canUnmute = ${canUnmute}`);
    };
    this.audioVideo.realtimeSubscribeToSetCanUnmuteLocalAudio(handler);
    handler(this.audioVideo.realtimeCanUnmuteLocalAudio());
  }

  updateRoster(): void {
    const roster = document.getElementById('roster');
    const newRosterCount = Object.keys(this.roster).length;
    while (roster.getElementsByTagName('li').length < newRosterCount) {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.appendChild(document.createElement('span'));
      li.appendChild(document.createElement('span'));
      roster.appendChild(li);
    }
    while (roster.getElementsByTagName('li').length > newRosterCount) {
      roster.removeChild(roster.getElementsByTagName('li')[0]);
    }
    const entries = roster.getElementsByTagName('li');
    let i = 0;
    for (const attendeeId in this.roster) {
      const spanName = entries[i].getElementsByTagName('span')[0];
      const spanStatus = entries[i].getElementsByTagName('span')[1];
      let statusClass = 'badge badge-pill ';
      let statusText = '\xa0'; // &nbsp
      if (this.roster[attendeeId].signalStrength < 1) {
        statusClass += 'badge-warning';
      } else if (this.roster[attendeeId].signalStrength === 0) {
        statusClass += 'badge-danger';
      } else if (this.roster[attendeeId].muted) {
        statusText = 'MUTED';
        statusClass += 'badge-secondary';
      } else if (this.roster[attendeeId].active) {
        statusText = 'SPEAKING';
        statusClass += 'badge-success';
      }
      this.updateProperty(spanName, 'innerText', this.roster[attendeeId].name);
      this.updateProperty(spanStatus, 'innerText', statusText);
      this.updateProperty(spanStatus, 'className', statusClass);
      i++;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateProperty(obj: any, key: string, value: string): void {
    if (value !== undefined && obj[key] !== value) {
      obj[key] = value;
    }
  }

  setupSubscribeToAttendeeIdPresenceHandler(): void {
    const handler = (
      attendeeId: string,
      present: boolean,
      externalUserId: string,
      dropped: boolean
    ): void => {
      this.log(`${attendeeId} present = ${present} (${externalUserId})`);
      const isContentAttendee = new DefaultModality(attendeeId).hasModality(
        DefaultModality.MODALITY_CONTENT
      );
      const isSelfAttendee =
        new DefaultModality(attendeeId).base() ===
        this.meetingSession.configuration.credentials.attendeeId;
      if (!present) {
        delete this.roster[attendeeId];
        this.updateRoster();
        this.log(`${attendeeId} dropped = ${dropped} (${externalUserId})`);
        return;
      }
      //If someone else share content, stop the current content share
      if (
        !this.allowMaxContentShare() &&
        !isSelfAttendee &&
        isContentAttendee &&
        this.isButtonOn('button-content-share')
      ) {
        this.contentShareStop();
      }
      if (!this.roster[attendeeId] || !this.roster[attendeeId].name) {
        this.roster[attendeeId] = {
          ...this.roster[attendeeId],
          ... {name: externalUserId.split('#').slice(-1)[0] + (isContentAttendee ? ' «Content»' : '')}
        };
      }
      this.audioVideo.realtimeSubscribeToVolumeIndicator(
        attendeeId,
        async (
          attendeeId: string,
          volume: number | null,
          muted: boolean | null,
          signalStrength: number | null
        ) => {
          if (!this.roster[attendeeId]) {
            return;
          }
          if (volume !== null) {
            this.roster[attendeeId].volume = Math.round(volume * 100);
          }
          if (muted !== null) {
            this.roster[attendeeId].muted = muted;
          }
          if (signalStrength !== null) {
            this.roster[attendeeId].signalStrength = Math.round(signalStrength * 100);
          }
          this.updateRoster();
        }
      );
    };

    this.attendeeIdPresenceHandler = handler;
    this.audioVideo.realtimeSubscribeToAttendeeIdPresence(handler);

    // Hang on to this so we can unsubscribe later.
    this.activeSpeakerHandler = (attendeeIds: string[]): void => {
      // First reset all roster active speaker information
      for (const attendeeId in this.roster) {
        this.roster[attendeeId].active = false;
      }

      // Then re-update roster and tile collection with latest information
      //
      // This will leave featured tiles up since this detector doesn't seem to clear
      // the list.
      for (const attendeeId of attendeeIds) {
        if (this.roster[attendeeId]) {
          this.roster[attendeeId].active = true;
          this.videoTileCollection.activeSpeakerAttendeeId = attendeeId
          break; // Only show the most active speaker
        }
      }
    };

    const scoreHandler = (scores: { [attendeeId: string]: number }) => {
      for (const attendeeId in scores) {
        if (this.roster[attendeeId]) {
          this.roster[attendeeId].score = scores[attendeeId];
        }
      }
      this.updateRoster();
    };

    this.audioVideo.subscribeToActiveSpeakerDetector(
      new DefaultActiveSpeakerPolicy(),
      this.activeSpeakerHandler,
      scoreHandler,
      this.showActiveSpeakerScores ? 100 : 0
    );
  }

  dataMessageHandler(dataMessage: DataMessage): void {
    if (!dataMessage.throttled) {
      const isSelf =
        dataMessage.senderAttendeeId === this.meetingSession.configuration.credentials.attendeeId;
      if (dataMessage.timestampMs <= this.lastReceivedMessageTimestamp) {
        return;
      }
      this.lastReceivedMessageTimestamp = dataMessage.timestampMs;
      const messageDiv = document.getElementById('receive-message') as HTMLDivElement;
      const messageNameSpan = document.createElement('div') as HTMLDivElement;
      messageNameSpan.classList.add('message-bubble-sender');
      messageNameSpan.innerText = dataMessage.senderExternalUserId.split('#').slice(-1)[0];
      const messageTextSpan = document.createElement('div') as HTMLDivElement;
      messageTextSpan.classList.add(isSelf ? 'message-bubble-self' : 'message-bubble-other');
      messageTextSpan.innerHTML = this.markdown
        .render(dataMessage.text())
        .replace(/[<]a /g, '<a target="_blank" ');
      const appendClass = (element: HTMLElement, className: string): void => {
        for (let i = 0; i < element.children.length; i++) {
          const child = element.children[i] as HTMLElement;
          child.classList.add(className);
          appendClass(child, className);
        }
      };
      appendClass(messageTextSpan, 'markdown');
      if (this.lastMessageSender !== dataMessage.senderAttendeeId) {
        messageDiv.appendChild(messageNameSpan);
      }
      this.lastMessageSender = dataMessage.senderAttendeeId;
      messageDiv.appendChild(messageTextSpan);
      messageDiv.scrollTop = messageDiv.scrollHeight;
    } else {
      this.log('Message is throttled. Please resend');
    }
  }

  setupDataMessage(): void {
    this.audioVideo.realtimeSubscribeToReceiveDataMessage(
      DemoMeetingApp.DATA_MESSAGE_TOPIC,
      (dataMessage: DataMessage) => {
        this.dataMessageHandler(dataMessage);
      }
    );
  }

  transcriptEventHandler = (transcriptEvent: TranscriptEvent): void => {
    if (!this.enableLiveTranscription) {
      // Toggle disabled 'Live Transcription' button to enabled when we receive any transcript event
      this.enableLiveTranscription = true;
      this.updateLiveTranscriptionDisplayState();

      // Transcripts view and the button to show and hide it are initially hidden
      // Show them when when live transcription gets enabled, and do not hide afterwards
      this.setButtonVisibility('button-live-transcription', true, 'on');
      this.transcriptContainerDiv.style.display = 'block';
    }

    if (transcriptEvent instanceof TranscriptionStatus) {
      this.appendStatusDiv(transcriptEvent);
      if (transcriptEvent.type === TranscriptionStatusType.STARTED) {
        // Determine word separator based on language code
        let languageCode = null;
        const transcriptionConfiguration = JSON.parse(transcriptEvent.transcriptionConfiguration);
        if (transcriptionConfiguration) {
          if (transcriptionConfiguration.EngineTranscribeSettings) {
            languageCode = transcriptionConfiguration.EngineTranscribeSettings.LanguageCode;
          } else if (transcriptionConfiguration.EngineTranscribeMedicalSettings) {
            languageCode = transcriptionConfiguration.EngineTranscribeMedicalSettings.languageCode;
          }
        }

        if (languageCode && LANGUAGES_NO_WORD_SEPARATOR.has(languageCode)) {
          this.noWordSeparatorForTranscription = true;
        }
      } else if ((transcriptEvent.type === TranscriptionStatusType.STOPPED || transcriptEvent.type === TranscriptionStatusType.FAILED) && this.enableLiveTranscription) {
        // When we receive a STOPPED status event:
        // 1. toggle enabled 'Live Transcription' button to disabled
        this.enableLiveTranscription = false;
        this.noWordSeparatorForTranscription = false;
        this.updateLiveTranscriptionDisplayState();

        // 2. force finalize all partial results
        this.partialTranscriptResultTimeMap.clear();
        this.partialTranscriptDiv = null;
        this.partialTranscriptResultMap.clear();
      }
    } else if (transcriptEvent instanceof Transcript) {
      for (const result of transcriptEvent.results) {
        const resultId = result.resultId;
        const isPartial = result.isPartial;
        if (!isPartial) {
          if (result.alternatives[0].entities?.length > 0) {
            for (const entity of result.alternatives[0].entities) {
              //split the entity based on space
              let contentArray = entity.content.split(' ');
              for (const content of contentArray) {
                this.transcriptEntitySet.add(content);
              }
            }
          }
        }
        this.partialTranscriptResultMap.set(resultId, result);
        this.partialTranscriptResultTimeMap.set(resultId, result.endTimeMs);
        this.renderPartialTranscriptResults();
        if (isPartial) {
          continue;
        }

        // Force finalizing partial results that's 5 seconds older than the latest one,
        // to prevent local partial results from indefinitely growing
        for (const [olderResultId, endTimeMs] of this.partialTranscriptResultTimeMap) {
          if (olderResultId === resultId) {
            break;
          } else if (endTimeMs < result.endTimeMs - 5000) {
            this.partialTranscriptResultTimeMap.delete(olderResultId);
          }
        }

        this.partialTranscriptResultTimeMap.delete(resultId);
        this.transcriptEntitySet.clear();

        if (this.partialTranscriptResultTimeMap.size === 0) {
          // No more partial results in current batch, reset current batch
          this.partialTranscriptDiv = null;
          this.partialTranscriptResultMap.clear();
        }
      }
    }

    this.transcriptContainerDiv.scrollTop = this.transcriptContainerDiv.scrollHeight;
  };

  renderPartialTranscriptResults = () => {
    if (this.partialTranscriptDiv) {
      // Keep updating existing partial result div
      this.updatePartialTranscriptDiv();
    } else {
      // All previous results were finalized. Create a new div for new results, update, then add it to DOM
      this.partialTranscriptDiv = document.createElement('div') as HTMLDivElement;
      this.updatePartialTranscriptDiv();
      this.transcriptContainerDiv.appendChild(this.partialTranscriptDiv);
    }
  };

  updatePartialTranscriptDiv = () => {
    this.partialTranscriptDiv.innerHTML = '';

    const partialTranscriptSegments: TranscriptSegment[] = [];
    for (const result of this.partialTranscriptResultMap.values()) {
      this.populatePartialTranscriptSegmentsFromResult(partialTranscriptSegments, result);
    }
    partialTranscriptSegments.sort((a, b) => a.startTimeMs - b.startTimeMs);

    const speakerToTranscriptSpanMap = new Map<string, HTMLSpanElement>();
    for (const segment of partialTranscriptSegments) {
      const newSpeakerId = segment.attendee.attendeeId;
      if (!speakerToTranscriptSpanMap.has(newSpeakerId)) {
        this.appendNewSpeakerTranscriptDiv(segment, speakerToTranscriptSpanMap);
      } else {
        const partialResultSpeakers: string[] = Array.from(speakerToTranscriptSpanMap.keys());
        if (partialResultSpeakers.indexOf(newSpeakerId) < partialResultSpeakers.length - 1) {
          // Not the latest speaker and we reach the end of a sentence, clear the speaker to Span mapping to break line
          speakerToTranscriptSpanMap.delete(newSpeakerId);
          this.appendNewSpeakerTranscriptDiv(segment, speakerToTranscriptSpanMap);
        } else {
          const transcriptSpan = speakerToTranscriptSpanMap.get(newSpeakerId);
          transcriptSpan.appendChild(this.createSpaceSpan());
          transcriptSpan.appendChild(segment.contentSpan);
        }
      }
    }
  };

  populatePartialTranscriptSegmentsFromResult = (segments: TranscriptSegment[], result: TranscriptResult) => {
    let startTimeMs: number = null;
    let attendee: Attendee = null;
    let contentSpan;
    for (const item of result.alternatives[0].items) {
      const itemContentSpan = document.createElement('span') as HTMLSpanElement;
      itemContentSpan.innerText = item.content;
      itemContentSpan.classList.add('transcript-content');
      // underline the word with red to show confidence level of predicted word being less than 0.3
      // for redaction, words are represented as '[Name]' and has a confidence of 0. Redacted words are only shown with highlighting.
      if (item.hasOwnProperty('confidence') && !item.content.startsWith("[") && item.confidence < 0.3) {
        itemContentSpan.classList.add('confidence-style');
      }

      // highlight the word in green to show the predicted word is a PII/PHI entity
      if (this.transcriptEntitySet.size > 0 && this.transcriptEntitySet.has(item.content)) {
        itemContentSpan.classList.add('entity-color');
      }

      if (!startTimeMs) {
        contentSpan = document.createElement('span') as HTMLSpanElement;
        contentSpan.appendChild(itemContentSpan);
        attendee = item.attendee;
        startTimeMs = item.startTimeMs;
      } else if (item.type === TranscriptItemType.PUNCTUATION) {
        contentSpan.appendChild(itemContentSpan);
        segments.push({
          contentSpan,
          attendee: attendee,
          startTimeMs: startTimeMs,
          endTimeMs: item.endTimeMs
        });
        startTimeMs = null;
        attendee = null;
      } else {
        if (this.noWordSeparatorForTranscription) {
          contentSpan.appendChild(itemContentSpan);
        } else {
          contentSpan.appendChild(this.createSpaceSpan());
          contentSpan.appendChild(itemContentSpan);
        }
      }
    }

    // Reached end of the result but there is no closing punctuation
    if (startTimeMs) {
      segments.push({
        contentSpan: contentSpan,
        attendee: attendee,
        startTimeMs: startTimeMs,
        endTimeMs: result.endTimeMs,
      });
    }
  };

  createSpaceSpan(): HTMLSpanElement {
    const spaceSpan = document.createElement('span') as HTMLSpanElement;
    spaceSpan.classList.add('transcript-content');
    spaceSpan.innerText = '\u00a0';
    return spaceSpan;
  };

  appendNewSpeakerTranscriptDiv = (
    segment: TranscriptSegment,
    speakerToTranscriptSpanMap: Map<string, HTMLSpanElement>) =>
  {
    const speakerTranscriptDiv = document.createElement('div') as HTMLDivElement;
    speakerTranscriptDiv.classList.add('transcript');

    const speakerSpan = document.createElement('span') as HTMLSpanElement;
    speakerSpan.classList.add('transcript-speaker');
    speakerSpan.innerText = segment.attendee.externalUserId.split('#').slice(-1)[0] + ': ';
    speakerTranscriptDiv.appendChild(speakerSpan);

    speakerTranscriptDiv.appendChild(segment.contentSpan);

    this.partialTranscriptDiv.appendChild(speakerTranscriptDiv);

    speakerToTranscriptSpanMap.set(segment.attendee.attendeeId, segment.contentSpan);
  };

  appendStatusDiv = (status: TranscriptionStatus) => {
    const statusDiv = document.createElement('div') as HTMLDivElement;
    statusDiv.innerText = '(Live Transcription ' + status.type + ' at '
      + new Date(status.eventTimeMs).toLocaleTimeString() + ' in ' + status.transcriptionRegion
      + ' with configuration: ' + status.transcriptionConfiguration + ')';
    this.transcriptContainerDiv.appendChild(statusDiv);
  };

  setupLiveTranscription = () => {
    this.audioVideo.transcriptionController?.subscribeToTranscriptEvent(this.transcriptEventHandler);
  };

  // eslint-disable-next-line
  async joinMeeting(): Promise<any> {
    const response = await fetch(
      `${DemoMeetingApp.BASE_URL}join?title=${encodeURIComponent(
        this.meeting
      )}&name=${encodeURIComponent(this.name)}&region=${encodeURIComponent(this.region)}&ns_es=${this.echoReductionCapability}`,
      {
        method: 'POST',
      }
    );
    const json = await response.json();
    if (json.error) {
      throw new Error(`Server error: ${json.error}`);
    }
    return json;
  }

  async startMediaCapture(): Promise<any> {
    await fetch(
      `${DemoMeetingApp.BASE_URL}startCapture?title=${encodeURIComponent(this.meeting)}`, {
        method: 'POST',
      });
  }

  async stopMediaCapture(): Promise<any> {
    await fetch(
      `${DemoMeetingApp.BASE_URL}endCapture?title=${encodeURIComponent(this.meeting)}`, {
        method: 'POST',
      });
  }


  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async endMeeting(): Promise<any> {
    await fetch(`${DemoMeetingApp.BASE_URL}end?title=${encodeURIComponent(this.meeting)}`, {
      method: 'POST',
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getAttendee(attendeeId: string): Promise<any> {
    const response = await fetch(
      `${DemoMeetingApp.BASE_URL}attendee?title=${encodeURIComponent(
        this.meeting
      )}&attendee=${encodeURIComponent(attendeeId)}`
    );
    const json = await response.json();
    if (json.error) {
      throw new Error(`Server error: ${json.error}`);
    }
    return json;
  }

  setupDeviceLabelTrigger(): void {
    // Note that device labels are privileged since they add to the
    // fingerprinting surface area of the browser session. In Chrome private
    // tabs and in all Firefox tabs, the labels can only be read once a
    // MediaStream is active. How to deal with this restriction depends on the
    // desired UX. The device controller includes an injectable device label
    // trigger which allows you to perform custom behavior in case there are no
    // labels, such as creating a temporary audio/video stream to unlock the
    // device names, which is the default behavior. Here we override the
    // trigger to also show an alert to let the user know that we are asking for
    // mic/camera permission.
    //
    // Also note that Firefox has its own device picker, which may be useful
    // for the first device selection. Subsequent device selections could use
    // a custom UX with a specific device id.
    if(!this.defaultBrowserBehaviour.doesNotSupportMediaDeviceLabels())
    {
      this.audioVideo.setDeviceLabelTrigger(
        async (): Promise<MediaStream> => {
          if (this.isRecorder() || this.isBroadcaster()) {
            throw new Error('Recorder or Broadcaster does not need device labels');
          }
          this.switchToFlow('flow-need-permission');
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          this.switchToFlow('flow-devices');
          return stream;
        }
    );
    }
  }

  populateDeviceList(
    elementId: string,
    genericName: string,
    devices: MediaDeviceInfo[],
    additionalOptions: string[]
  ): void {
    const list = document.getElementById(elementId) as HTMLSelectElement;
    while (list.firstElementChild) {
      list.removeChild(list.firstElementChild);
    }
    for (let i = 0; i < devices.length; i++) {
      const option = document.createElement('option');
      list.appendChild(option);
      option.text = devices[i].label || `${genericName} ${i + 1}`;
      option.value = devices[i].deviceId;
    }
    if (additionalOptions.length > 0) {
      const separator = document.createElement('option');
      separator.disabled = true;
      separator.text = '──────────';
      list.appendChild(separator);
      for (const additionalOption of additionalOptions) {
        const option = document.createElement('option');
        list.appendChild(option);
        option.text = additionalOption;
        option.value = additionalOption;
      }
    }
    if (!list.firstElementChild) {
      const option = document.createElement('option');
      option.text = 'Device selection unavailable';
      list.appendChild(option);
    }
  }

  populateVideoPreviewFilterList(
    elementId: string,
    genericName: string,
    filters: VideoFilterName[]
  ): void {
    const list = document.getElementById(elementId) as HTMLSelectElement;
    while (list.firstElementChild) {
      list.removeChild(list.firstElementChild);
    }
    for (let i = 0; i < filters.length; i++) {
      const option = document.createElement('option');
      list.appendChild(option);
      option.text = filters[i] || `${genericName} ${i + 1}`;
      option.value = filters[i];
    }

    if (!list.firstElementChild) {
      const option = document.createElement('option');
      option.text = 'Filter selection unavailable';
      list.appendChild(option);
    }
  }

  populateInMeetingDeviceList(
    elementId: string,
    genericName: string,
    devices: MediaDeviceInfo[],
    additionalOptions: string[],
    additionalToggles: Toggle[] | undefined,
    callback: (name: string) => void
  ): void {
    const menu = document.getElementById(elementId) as HTMLDivElement;
    while (menu.firstElementChild) {
      menu.removeChild(menu.firstElementChild);
    }
    for (let i = 0; i < devices.length; i++) {
      this.createDropdownMenuItem(menu, devices[i].label || `${genericName} ${i + 1}`, () => {
        callback(devices[i].deviceId);
      });
    }
    if (additionalOptions.length) {
      this.createDropdownMenuItem(menu, '──────────', () => {}).classList.add('text-center');
      for (const additionalOption of additionalOptions) {
        this.createDropdownMenuItem(
          menu,
          additionalOption,
          () => {
            callback(additionalOption);
          },
          `${elementId}-${additionalOption.replace(/\s/g, '-')}`
        );
      }
    }
    if (additionalToggles?.length) {
      this.createDropdownMenuItem(menu, '──────────', () => {}).classList.add('text-center');
      for (const { name, oncreate, action } of additionalToggles) {
        const id = `toggle-${elementId}-${name.replace(/\s/g, '-')}`;
        const elem = this.createDropdownMenuItem(menu, name, action, id);
        oncreate(elem);
      }
    }
    if (!menu.firstElementChild) {
      this.createDropdownMenuItem(menu, 'Device selection unavailable', () => {});
    }
  }

  createDropdownMenuItem(
    menu: HTMLDivElement,
    title: string,
    clickHandler: () => void,
    id?: string
  ): HTMLButtonElement {
    const button = document.createElement('button') as HTMLButtonElement;
    menu.appendChild(button);
    button.innerText = title;
    button.classList.add('dropdown-item');
    this.updateProperty(button, 'id', id);
    button.addEventListener('click', () => {
      clickHandler();
    });
    return button;
  }

  async populateAllDeviceLists(): Promise<void> {
    await this.populateAudioInputList();
    await this.populateVideoInputList();
    await this.populateAudioOutputList();
  }

  private async selectVideoFilterByName(name: VideoFilterName): Promise<void> {
    this.selectedVideoFilterItem = name;
    this.log(`clicking video filter ${this.selectedVideoFilterItem}`);
    this.toggleButton(
      'button-video-filter',
      this.selectedVideoFilterItem === 'None' ? 'off' : 'on'
    );
    if (this.isButtonOn('button-camera')) {
      try {
        await this.openVideoInputFromSelection(this.selectedVideoInput, false);
      } catch (err) {
        fatal(err);
        this.log('Failed to choose VideoTransformDevice', err);
      }
    }
  }

  private async stopVideoProcessor(): Promise<void>  {
    this.log('Clearing filter variables and stopping the video transform device');
    this.chosenVideoFilter = 'None';
    this.selectedVideoFilterItem = 'None';
    this.chosenVideoTransformDevice?.stop();
  }

  private getBackgroundBlurSpec(): BackgroundFilterSpec {
    return {
      paths: BACKGROUND_BLUR_PATHS,
      model: BACKGROUND_BLUR_MODEL,
      ...BACKGROUND_BLUR_ASSET_SPEC
    };
  }

  private async populateVideoFilterInputList(isPreviewWindow: boolean): Promise<void> {
    const genericName = 'Filter';
    let filters: VideoFilterName[] = ['None'];

    if (this.areVideoFiltersSupported()) {
      filters = filters.concat(VIDEO_FILTERS);
      if (platformCanSupportBodyPixWithoutDegradation()) {
        if (!this.loadingBodyPixDependencyPromise) {
          this.loadingBodyPixDependencyPromise = loadBodyPixDependency(this.loadingBodyPixDependencyTimeoutMs);
        }
        // do not use `await` to avoid blocking page loading
        this.loadingBodyPixDependencyPromise.then(() => {
          filters.push('Segmentation');
          this.populateFilterList(isPreviewWindow, genericName, filters);
        }).catch(err => {
          this.log('Could not load BodyPix dependency', err);
        });
      }

      if (this.supportsBackgroundBlur) {
        filters.push('Background Blur 10% CPU');
        filters.push('Background Blur 20% CPU');
        filters.push('Background Blur 30% CPU');
        filters.push('Background Blur 40% CPU');
      }

      if (this.supportsBackgroundReplacement) {
        filters.push('Background Replacement');
      }
    }

    this.populateFilterList(isPreviewWindow, genericName, filters);
  }

  private async populateFilterList(isPreviewWindow: boolean, genericName: string, filters: VideoFilterName[]): Promise<void> {
    if(isPreviewWindow) {
      this.populateVideoPreviewFilterList(
        'video-input-filter',
        genericName,
        filters
      );
    }
    else  {
      this.populateInMeetingDeviceList(
        'dropdown-menu-filter',
        genericName,
        [],
        filters,
        undefined,
        async (name: VideoFilterName) => {
          await this.selectVideoFilterByName(name);
        }
      );
    }
  }

  async populateAudioInputList(): Promise<void> {
    const genericName = 'Microphone';
    let additionalDevices = ['None', '440 Hz', 'Prerecorded Speech', 'Echo'];
    const additionalStereoTestDevices = ['L-500Hz R-1000Hz', 'Prerecorded Speech (Stereo)'];
    const additionalToggles = [];

    // This can't work unless Web Audio is enabled.
    if (this.enableWebAudio && this.supportsVoiceFocus) {
      additionalToggles.push({
        name: 'Amazon Voice Focus',
        oncreate: (elem: HTMLElement) => {
          this.voiceFocusDisplayables.push(elem);
        },
        action: () => this.toggleVoiceFocusInMeeting(),
      });
    }

    additionalToggles.push({
      name: 'Live Transcription',
      oncreate: (elem: HTMLElement) => {
        this.liveTranscriptionDisplayables.push(elem);
      },
      action: () => this.toggleLiveTranscription(),
    });

    this.populateDeviceList(
      'audio-input',
      genericName,
      await this.audioVideo.listAudioInputDevices(),
      additionalDevices
    );

    if (this.usingStereoMusicAudioProfile) {
      additionalDevices = additionalDevices.concat(additionalStereoTestDevices);
    }

    this.populateInMeetingDeviceList(
      'dropdown-menu-microphone',
      genericName,
      await this.audioVideo.listAudioInputDevices(),
      additionalDevices,
      additionalToggles,
      async (name: string) => {
        await this.selectAudioInputDeviceByName(name);
      }
    );
  }

  private areVideoFiltersSupported(): boolean {
    return this.defaultBrowserBehaviour.supportsCanvasCapturedStreamPlayback();
  }

  private isVoiceFocusActive(): boolean {
    return this.currentAudioInputDevice instanceof VoiceFocusTransformDevice;
  }

  private updateVoiceFocusDisplayState(): void {
    const active = this.isVoiceFocusActive();
    this.log('Updating Amazon Voice Focus display state:', active);
    for (const elem of this.voiceFocusDisplayables) {
      elem.classList.toggle('vf-active', active);
    }
  }

  private isVoiceFocusEnabled(): boolean {
    this.log('VF supported:', this.supportsVoiceFocus);
    this.log('VF enabled:', this.enableVoiceFocus);
    return this.supportsVoiceFocus && this.enableVoiceFocus;
  }

  private async reselectAudioInputDevice(): Promise<void> {
    const current = this.currentAudioInputDevice;

    if (current instanceof VoiceFocusTransformDevice) {
      // Unwrap and rewrap if Amazon Voice Focus is selected.
      const intrinsic = current.getInnerDevice();
      const device = await this.audioInputSelectionWithOptionalVoiceFocus(intrinsic);
      return this.selectAudioInputDevice(device);
    }

    // If it's another kind of transform device, just reselect it.
    if (isAudioTransformDevice(current)) {
      return this.selectAudioInputDevice(current);
    }

    // Otherwise, apply Amazon Voice Focus if needed.
    const device = await this.audioInputSelectionWithOptionalVoiceFocus(current);
    return this.selectAudioInputDevice(device);
  }

  private async toggleVoiceFocusInMeeting(): Promise<void> {
    const elem = document.getElementById('add-voice-focus') as HTMLInputElement;
    this.enableVoiceFocus = this.supportsVoiceFocus && !this.enableVoiceFocus;
    elem.checked = this.enableVoiceFocus;
    this.log('Amazon Voice Focus toggle is now', elem.checked);

    await this.reselectAudioInputDevice();
  }

  private updateLiveTranscriptionDisplayState() {
    this.log('Updating live transcription display state to:', this.enableLiveTranscription);
    for (const elem of this.liveTranscriptionDisplayables) {
      elem.classList.toggle('live-transcription-active', this.enableLiveTranscription);
    }
  }

  private async toggleLiveTranscription(): Promise<void> {
    this.log('live transcription were previously set to ' + this.enableLiveTranscription + '; attempting to toggle');

    if (this.enableLiveTranscription) {
      const response = await fetch(`${DemoMeetingApp.BASE_URL}${encodeURIComponent('stop_transcription')}?title=${encodeURIComponent(this.meeting)}`, {
        method: 'POST',
      });
      const json = await response.json();
      if (json.error) {
        throw new Error(`Server error: ${json.error}`);
      }
    } else {
      const liveTranscriptionModal = document.getElementById(`live-transcription-modal`);
      liveTranscriptionModal.style.display = "block";
    }
  }

  async populateVideoInputList(): Promise<void> {
    const genericName = 'Camera';
    const additionalDevices = ['None', 'Blue', 'SMPTE Color Bars'];
    this.populateDeviceList(
      'video-input',
      genericName,
      await this.audioVideo.listVideoInputDevices(),
      additionalDevices
    );
    this.populateInMeetingDeviceList(
      'dropdown-menu-camera',
      genericName,
      await this.audioVideo.listVideoInputDevices(),
      additionalDevices,
      undefined,
      async (name: string) => {
        try {
          await this.openVideoInputFromSelection(name, false);
        } catch (err) {
          fatal(err);
        }
      }
    );
    const cameras = await this.audioVideo.listVideoInputDevices();
    this.cameraDeviceIds = cameras.map(deviceInfo => {
      return deviceInfo.deviceId;
    });
  }

  async populateAudioOutputList(): Promise<void> {
    const supportsChoosing = this.defaultBrowserBehaviour.supportsSetSinkId();
    const genericName = 'Speaker';
    const additionalDevices: string[] = [];
    const devices = supportsChoosing ? await this.audioVideo.listAudioOutputDevices() : [];
    this.populateDeviceList('audio-output', genericName, devices, additionalDevices);
    this.populateInMeetingDeviceList(
      'dropdown-menu-speaker',
      genericName,
      devices,
      additionalDevices,
      undefined,
      async (name: string) => {
        if (!supportsChoosing) {
          return;
        }
        try {
          await this.chooseAudioOutputDevice(name);
        } catch (e) {
          fatal(e);
          this.log('Failed to chooseAudioOutputDevice', e);
        }
      }
    );
  }

  private async chooseAudioOutputDevice(device: string): Promise<void> {
    // Set it for the content share stream if we can.
    const videoElem = document.getElementById('content-share-video') as HTMLVideoElement;
    if (this.defaultBrowserBehaviour.supportsSetSinkId()) {
      // @ts-ignore
      videoElem.setSinkId(device);
    }

    await this.audioVideo.chooseAudioOutputDevice(device);
  }

  private analyserNodeCallback: undefined | (() => void);

  async selectedAudioInput(): Promise<AudioInputDevice> {
    const audioInput = document.getElementById('audio-input') as HTMLSelectElement;
    const device = await this.audioInputSelectionToDevice(audioInput.value);
    return device;
  }

  async selectAudioInputDevice(device: AudioInputDevice): Promise<void> {
    this.currentAudioInputDevice = device;
    this.log('Selecting audio input', device);
    try {
      await this.audioVideo.chooseAudioInputDevice(device);
    } catch (e) {
      fatal(e);
      this.log(`failed to choose audio input device ${device}`, e);
    }
    this.updateVoiceFocusDisplayState();
  }

  async selectAudioInputDeviceByName(name: string): Promise<void> {
    this.log('Selecting audio input device by name:', name);
    const device = await this.audioInputSelectionToDevice(name);
    return this.selectAudioInputDevice(device);
  }

  async openAudioInputFromSelection(): Promise<void> {
    const device = await this.selectedAudioInput();
    await this.selectAudioInputDevice(device);
  }

  async openAudioInputFromSelectionAndPreview(): Promise<void> {
    await this.stopAudioPreview();
    await this.openAudioInputFromSelection();
    this.log('Starting audio preview.');
    await this.startAudioPreview();
  }

  setAudioPreviewPercent(percent: number): void {
    const audioPreview = document.getElementById('audio-preview');
    if (!audioPreview) {
      return;
    }
    this.updateProperty(audioPreview.style, 'transitionDuration', '33ms');
    this.updateProperty(audioPreview.style, 'width', `${percent}%`);
    if (audioPreview.getAttribute('aria-valuenow') !== `${percent}`) {
      audioPreview.setAttribute('aria-valuenow', `${percent}`);
    }
  }

  async stopAudioPreview(): Promise<void> {
    if (!this.analyserNode) {
      return;
    }

    this.analyserNodeCallback = undefined;

    // Disconnect the analyser node from its inputs and outputs.
    this.analyserNode.disconnect();
    this.analyserNode.removeOriginalInputs();

    this.analyserNode = undefined;
  }

  startAudioPreview(): void {
    this.setAudioPreviewPercent(0);

    // Recreate.
    if (this.analyserNode) {
      // Disconnect the analyser node from its inputs and outputs.
      this.analyserNode.disconnect();
      this.analyserNode.removeOriginalInputs();

      this.analyserNode = undefined;
    }

    const analyserNode = this.audioVideo.createAnalyserNodeForAudioInput();

    if (!analyserNode) {
      return;
    }

    if (!analyserNode.getByteTimeDomainData) {
      document.getElementById('audio-preview').parentElement.style.visibility = 'hidden';
      return;
    }

    this.analyserNode = analyserNode;
    const data = new Uint8Array(analyserNode.fftSize);
    let frameIndex = 0;
    this.analyserNodeCallback = () => {
      if (frameIndex === 0) {
        analyserNode.getByteTimeDomainData(data);
        const lowest = 0.01;
        let max = lowest;
        for (const f of data) {
          max = Math.max(max, (f - 128) / 128);
        }
        let normalized = (Math.log(lowest) - Math.log(max)) / Math.log(lowest);
        let percent = Math.min(Math.max(normalized * 100, 0), 100);
        this.setAudioPreviewPercent(percent);
      }
      frameIndex = (frameIndex + 1) % 2;
      if (this.analyserNodeCallback) {
        requestAnimationFrame(this.analyserNodeCallback);
      }
    };
    requestAnimationFrame(this.analyserNodeCallback);
  }

  async openAudioOutputFromSelection(): Promise<void> {
    if (this.defaultBrowserBehaviour.supportsSetSinkId()) {
      try {
        const audioOutput = document.getElementById('audio-output') as HTMLSelectElement;
        await this.chooseAudioOutputDevice(audioOutput.value);
      } catch (e) {
        fatal(e);
        this.log('failed to chooseAudioOutputDevice', e);
      }
    }
    const audioMix = document.getElementById('meeting-audio') as HTMLAudioElement;
    try {
      await this.audioVideo.bindAudioElement(audioMix);
    } catch (e) {
      fatal(e);
      this.log('failed to bindAudioElement', e);
    }
  }

  private selectedVideoInput: string | null = null;
  async openVideoInputFromSelection(selection: string | null, showPreview: boolean): Promise<void> {
    if (selection) {
      this.selectedVideoInput = selection;
    }
    this.log(`Switching to: ${this.selectedVideoInput}`);
    const device = await this.videoInputSelectionToDevice(this.selectedVideoInput);
    if (device === null) {
      if (showPreview) {
        this.audioVideo.stopVideoPreviewForVideoInput(
          document.getElementById('video-preview') as HTMLVideoElement
        );
      }
      this.audioVideo.stopLocalVideoTile();
      this.toggleButton('button-camera', 'off');
      // choose video input null is redundant since we expect stopLocalVideoTile to clean up
      try {
        await this.audioVideo.chooseVideoInputDevice(device);
      } catch (e) {
        fatal(e);
        this.log(`failed to chooseVideoInputDevice ${device}`, e);
      }
      this.log('no video device selected');
    }
    try {
      await this.audioVideo.chooseVideoInputDevice(device);
    } catch (e) {
      fatal(e);
      this.log(`failed to chooseVideoInputDevice ${device}`, e);
    }

    if (showPreview) {
      this.audioVideo.startVideoPreviewForVideoInput(
        document.getElementById('video-preview') as HTMLVideoElement
      );
    }
  }

  private async audioInputSelectionToIntrinsicDevice(value: string): Promise<Device> {
    if (this.isRecorder() || this.isBroadcaster()) {
      return null;
    }

    if (value === '440 Hz') {
      return DefaultDeviceController.synthesizeAudioDevice(440);
    }

    if (value === 'L-500Hz R-1000Hz') {
      return this.synthesizeStereoTones(500, 1000);
    }

    if (value === 'Prerecorded Speech') {
      return this.streamAudioFile('audio_file');
    }

    if (value === 'Prerecorded Speech (Stereo)') {
      return this.streamAudioFile('stereo_audio_file', true);
    }

    // use the speaker output MediaStream with a 50ms delay and a 20% volume reduction as audio input
    if (value === 'Echo') {
      try {
        const speakerStream = await this.audioVideo.getCurrentMeetingAudioStream();

        const audioContext = DefaultDeviceController.getAudioContext();
        const streamDestination = audioContext.createMediaStreamDestination();
        const audioSourceNode = audioContext.createMediaStreamSource(speakerStream);
        const delayNode = audioContext.createDelay(0.05);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0.8;

        // connect the AudioSourceNode, DelayNode and GainNode to the same output destination
        audioSourceNode.connect(delayNode);
        delayNode.connect(gainNode);
        gainNode.connect(streamDestination);

        return streamDestination.stream;
      } catch (e) {
        this.log(`Error creating Echo`);
        return null;
      }
    }

    if (value === 'None') {
      return null;
    }

    return value;
  }

  /**
   * Generate a stereo tone by using 2 OsciallatorNode's that
   * produce 2 different frequencies. The output of these 2
   * nodes is passed through a ChannelMergerNode to obtain
   * an audio stream with stereo channels where the left channel
   * contains the samples genrated by oscillatorNodeLeft and the 
   * right channel contains samples generated by oscillatorNodeRight.
   */
  private async synthesizeStereoTones(toneHzLeft: number, toneHzRight: number): Promise<MediaStream> {
    const audioContext = DefaultDeviceController.getAudioContext();
    const outputNode = audioContext.createMediaStreamDestination();
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.1;
    gainNode.connect(outputNode);
    const oscillatorNodeLeft = audioContext.createOscillator();
    oscillatorNodeLeft.frequency.value = toneHzLeft;
    const oscillatorNodeRight = audioContext.createOscillator();
    oscillatorNodeRight.frequency.value = toneHzRight;
    const mergerNode = audioContext.createChannelMerger(2);
    oscillatorNodeLeft.connect(mergerNode, 0, 0);
    oscillatorNodeRight.connect(mergerNode, 0, 1);
    mergerNode.connect(gainNode);
    oscillatorNodeLeft.start();
    oscillatorNodeRight.start();
    return outputNode.stream;
  }

  private async streamAudioFile(audioPath: string, shouldLoop: boolean = false): Promise<MediaStream> {
    try {
      const resp = await fetch(audioPath);
      const bytes = await resp.arrayBuffer();
      const audioData = new TextDecoder('utf8').decode(bytes);
      const audio = new Audio('data:audio/mpeg;base64,' + audioData);
      audio.loop = shouldLoop;
      audio.crossOrigin = 'anonymous';
      audio.play();
      // @ts-ignore
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const streamDestination = audioContext.createMediaStreamDestination();
      const mediaElementSource = audioContext.createMediaElementSource(audio);
      mediaElementSource.connect(streamDestination);
      return streamDestination.stream;
    } catch (e) {
      this.log(`Error fetching audio from ${audioPath}: ${e}`);
      return null;
    }
  }

  private async getVoiceFocusDeviceTransformer(maxComplexity?: VoiceFocusModelComplexity): Promise<VoiceFocusDeviceTransformer> {
    if (this.voiceFocusTransformer) {
      return this.voiceFocusTransformer;
    }

    function exceeds(configured: VoiceFocusModelComplexity): boolean {
      const max = Number.parseInt(maxComplexity.substring(1), 10);
      const complexity = Number.parseInt(configured.substring(1), 10);
      return complexity > max;
    }

    const logger = new ConsoleLogger('SDK', LogLevel.DEBUG);

    // Find out what it will actually execute, and cap it if needed.
    const spec: VoiceFocusSpec = getVoiceFocusSpec(this.joinInfo);
    const config = await VoiceFocusDeviceTransformer.configure(spec, { logger });

    let transformer;
    if (maxComplexity && config.supported && exceeds(config.model.variant)) {
      logger.info(`Downgrading VF to ${maxComplexity}`);
      spec.variant = maxComplexity;
      transformer = VoiceFocusDeviceTransformer.create(spec, { logger }, undefined, this.joinInfo);
    } else {
      transformer = VoiceFocusDeviceTransformer.create(spec, { logger }, config, this.joinInfo);
    }

    return this.voiceFocusTransformer = await transformer;
  }

  private async createVoiceFocusDevice(inner: Device): Promise<VoiceFocusTransformDevice | Device> {
    if (!this.supportsVoiceFocus) {
      return inner;
    }

    if (this.voiceFocusDevice) {
      // Dismantle the old one.
      return (this.voiceFocusDevice = await this.voiceFocusDevice.chooseNewInnerDevice(inner));
    }

    try {
      const transformer = await this.getVoiceFocusDeviceTransformer(MAX_VOICE_FOCUS_COMPLEXITY);
      const vf: VoiceFocusTransformDevice = await transformer.createTransformDevice(inner);
      if (vf) {
        await vf.observeMeetingAudio(this.audioVideo);
        return this.voiceFocusDevice = vf;
      }
    } catch (e) {
      // Fall through.
    }
    return inner;
  }

  private async audioInputSelectionWithOptionalVoiceFocus(
    device: Device
  ): Promise<Device | VoiceFocusTransformDevice> {
    if (this.isVoiceFocusEnabled()) {
      if (!this.voiceFocusDevice) {
        return this.createVoiceFocusDevice(device);
      }

      // Switch out the inner if needed.
      // The reuse of the Voice Focus device is more efficient, particularly if
      // reselecting the same inner -- no need to modify the Web Audio graph.
      // Allowing the Voice Focus device to manage toggling Voice Focus on and off
      // also
      return (this.voiceFocusDevice = await this.voiceFocusDevice.chooseNewInnerDevice(device));
    }

    return device;
  }

  private async audioInputSelectionToDevice(
    value: string
  ): Promise<Device | VoiceFocusTransformDevice> {
    const inner = await this.audioInputSelectionToIntrinsicDevice(value);
    return this.audioInputSelectionWithOptionalVoiceFocus(inner);
  }

  private videoInputSelectionToIntrinsicDevice(value: string): Device {
    if (value === 'Blue') {
      return DefaultDeviceController.synthesizeVideoDevice('blue');
    }

    if (value === 'SMPTE Color Bars') {
      return DefaultDeviceController.synthesizeVideoDevice('smpte');
    }

    return value;
  }

  private async videoFilterToProcessor(videoFilter: VideoFilterName): Promise<VideoFrameProcessor | null> {
    this.log(`Choosing video filter ${videoFilter}`);

    if (videoFilter === 'Emojify') {
      return new EmojifyVideoFrameProcessor('🚀');
    }

    if (videoFilter === 'CircularCut') {
      return new CircularCut();
    }

    if (videoFilter === 'NoOp') {
      return new NoOpVideoFrameProcessor();
    }

    if (videoFilter === 'Segmentation') {
      return new SegmentationProcessor();
    }

    if (videoFilter === 'Resize (9/16)') {
      return new ResizeProcessor(0.5625);  // 16/9 Aspect Ratio
    }

    if (videoFilter.startsWith('Background Blur')) {
      // In the event that frames start being dropped we should take some action to remove the background blur.
      this.blurObserver = {
        filterFrameDurationHigh: (event) => {
          this.log(`background filter duration high: framed dropped - ${event.framesDropped}, avg - ${event.avgFilterDurationMillis} ms, frame rate - ${event.framerate}, period - ${event.periodMillis} ms`);
        },
        filterCPUUtilizationHigh: (event) => {
          this.log(`background filter CPU utilization high: ${event.cpuUtilization}%`);
        }
      };

      const cpuUtilization: number = Number(videoFilter.match(/([0-9]{2})%/)[1]);
      this.blurProcessor = await BackgroundBlurVideoFrameProcessor.create(this.getBackgroundBlurSpec(), {filterCPUUtilization: cpuUtilization});
      this.blurProcessor.addObserver(this.blurObserver);
      return this.blurProcessor;
    }

    if (videoFilter.startsWith('Background Replacement')) {
      // In the event that frames start being dropped we should take some action to remove the background replacement.
      this.replacementObserver = {
        filterFrameDurationHigh: (event) => {
          this.log(`background filter duration high: framed dropped - ${event.framesDropped}, avg - ${event.avgFilterDurationMillis} ms, frame rate - ${event.framerate}, period - ${event.periodMillis} ms`);
        }
      };

      this.replacementProcessor = await BackgroundReplacementVideoFrameProcessor.create(this.getBackgroundBlurSpec(), await this.getBackgroundReplacementOptions());
      this.replacementProcessor.addObserver(this.replacementObserver);
      return this.replacementProcessor;
    }

    return null;
  }

  private async videoInputSelectionWithOptionalFilter(
    innerDevice: Device
  ): Promise<VideoInputDevice> {
    if (this.selectedVideoFilterItem === 'None') {
      return innerDevice;
    }

    if (
      this.chosenVideoTransformDevice &&
      this.selectedVideoFilterItem === this.chosenVideoFilter
    ) {
      if (this.chosenVideoTransformDevice.getInnerDevice() !== innerDevice) {
        // switching device
        this.chosenVideoTransformDevice = this.chosenVideoTransformDevice.chooseNewInnerDevice(
          innerDevice
        );
      }
      return this.chosenVideoTransformDevice;
    }

    // A different processor is selected then we need to discard old one and recreate
    if (this.chosenVideoTransformDevice) {
      await this.chosenVideoTransformDevice.stop();
    }

    const proc = await this.videoFilterToProcessor(this.selectedVideoFilterItem);
    this.chosenVideoFilter = this.selectedVideoFilterItem;
    this.chosenVideoTransformDevice = new DefaultVideoTransformDevice(
      this.meetingLogger,
      innerDevice,
      [proc]
    );
    return this.chosenVideoTransformDevice;
  }

  private async videoInputSelectionToDevice(value: string): Promise<VideoInputDevice> {
    if (this.isRecorder() || this.isBroadcaster() || value === 'None') {
      return null;
    }
    const intrinsicDevice = this.videoInputSelectionToIntrinsicDevice(value);
    return await this.videoInputSelectionWithOptionalFilter(intrinsicDevice);
  }

  private initContentShareDropDownItems(): void {
    let item = document.getElementById('dropdown-item-content-share-screen-capture');
    item.addEventListener('click', () => {
      this.contentShareType = ContentShareType.ScreenCapture;
      this.contentShareStart();
    });

    item = document.getElementById('dropdown-item-content-share-screen-test-video');
    item.addEventListener('click', () => {
      this.contentShareType = ContentShareType.VideoFile;
      this.contentShareStart(DemoMeetingApp.testVideo);
    });

    item = document.getElementById('dropdown-item-content-share-test-mono-audio-speech');
    item.addEventListener('click', () => {
      this.contentShareStartAudio('audio_file');
    });

    item = document.getElementById('dropdown-item-content-share-test-stereo-audio-speech');
    item.addEventListener('click', () => {
      this.contentShareStartAudio('stereo_audio_file');
    });
    if (!this.usingStereoMusicAudioProfile) {
      item.style.display = 'none';
    }

    item = document.getElementById('dropdown-item-content-share-test-stereo-audio-tone');
    item.addEventListener('click', () => {
      this.contentShareStartAudio();
    });
    if (!this.usingStereoMusicAudioProfile) {
      item.style.display = 'none';
    }

    document.getElementById('content-share-item').addEventListener('change', () => {
      const fileList = document.getElementById('content-share-item') as HTMLInputElement;
      const file = fileList.files[0];
      if (!file) {
        this.log('no content share selected');
        return;
      }
      const url = URL.createObjectURL(file);
      this.log(`content share selected: ${url}`);
      this.contentShareType = ContentShareType.VideoFile;
      this.contentShareStart(url);
      fileList.value = '';
      (document.getElementById('dropdown-item-content-share-file-item') as HTMLDivElement).click();
    });

    document.getElementById('dropdown-item-content-share-stop').addEventListener('click', () => {
      this.contentShareStop();
    });
  }

  private async playToStream(videoFile: HTMLVideoElement): Promise<MediaStream> {
    await videoFile.play();

    if (this.defaultBrowserBehaviour.hasFirefoxWebRTC()) {
      // @ts-ignore
      return videoFile.mozCaptureStream();
    }

    // @ts-ignore
    return videoFile.captureStream();
  }

  private async contentShareStart(videoUrl?: string): Promise<void> {
    switch (this.contentShareType) {
      case ContentShareType.ScreenCapture: {
        try {
          await this.audioVideo.startContentShareFromScreenCapture();
        } catch (e) {
          this.meetingLogger?.error(`Could not start content share: ${e}`);
          return;
        }
        break;
      }
      case ContentShareType.VideoFile: {
        const videoFile = document.getElementById('content-share-video') as HTMLVideoElement;
        if (videoUrl) {
          videoFile.src = videoUrl;
        }

        const mediaStream = await this.playToStream(videoFile);
        try {
          // getDisplayMedia can throw.
          await this.audioVideo.startContentShare(mediaStream);
        } catch (e) {
          this.meetingLogger?.error(`Could not start content share: ${e}`);
          return;
        }
        break;
      }
    }

    this.toggleButton('button-content-share', 'on');
    this.updateContentShareDropdown(true);
  }

  private async contentShareStartAudio(audioPath: string | null = null) {
    let mediaStream: MediaStream = null;
    if (!audioPath) {
      mediaStream = await this.synthesizeStereoTones(500, 1000);
    } else {
      mediaStream = await this.streamAudioFile(audioPath, true);
    }
    try {
      // getDisplayMedia can throw.
      await this.audioVideo.startContentShare(mediaStream);
    } catch (e) {
      this.meetingLogger?.error(`Could not start content share: ${e}`);
      return;
    }
    this.toggleButton('button-content-share', 'on');
    this.updateContentShareDropdown(true);
  }

  private async contentShareStop(): Promise<void> {
    this.audioVideo.stopContentShare();
    this.toggleButton('button-pause-content-share', 'off');
    this.toggleButton('button-content-share', 'off');
    this.updateContentShareDropdown(false);

    if (this.contentShareType === ContentShareType.VideoFile) {
      const videoFile = document.getElementById('content-share-video') as HTMLVideoElement;
      videoFile.pause();
      videoFile.style.display = 'none';
    }
  }

  private updateContentShareDropdown(enabled: boolean): void {
    document.getElementById('dropdown-item-content-share-screen-capture').style.display = enabled ? 'none' : 'block';
    document.getElementById('dropdown-item-content-share-screen-test-video').style.display = enabled ? 'none' : 'block';
    document.getElementById('dropdown-item-content-share-test-mono-audio-speech').style.display = enabled ? 'none' : 'block';
    document.getElementById('dropdown-item-content-share-test-stereo-audio-speech').style.display = enabled ? 'none' : this.usingStereoMusicAudioProfile ? 'block' : 'none';
    document.getElementById('dropdown-item-content-share-test-stereo-audio-tone').style.display = enabled ? 'none' : this.usingStereoMusicAudioProfile ? 'block' : 'none';
    document.getElementById('dropdown-item-content-share-file-item').style.display = enabled ? 'none' : 'block';
    document.getElementById('dropdown-item-content-share-stop').style.display = enabled ? 'block' : 'none';
  }

  isRecorder(): boolean {
    return new URL(window.location.href).searchParams.get('record') === 'true';
  }

  isBroadcaster(): boolean {
    return new URL(window.location.href).searchParams.get('broadcast') === 'true';
  }

  isAbortingOnReconnect(): boolean {
    return new URL(window.location.href).searchParams.get('abort-on-reconnect') === 'true';
  }

  async authenticate(): Promise<string> {
    this.joinInfo = (await this.joinMeeting()).JoinInfo;
    const configuration = new MeetingSessionConfiguration(this.joinInfo.Meeting, this.joinInfo.Attendee);
    await this.initializeMeetingSession(configuration);
    const url = new URL(window.location.href);
    url.searchParams.set('m', this.meeting);
    history.replaceState({}, `${this.meeting}`, url.toString());
    return configuration.meetingId;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log(str: string, ...args: any[]): void {
    console.log.apply(console, [`[DEMO] ${str}`, ...args]);
  }

  audioVideoDidStartConnecting(reconnecting: boolean): void {
    this.log(`session connecting. reconnecting: ${reconnecting}`);
    if (reconnecting && this.isAbortingOnReconnect()) {
        fatal(Error('reconnect occured with abort-on-reconnect set to true'));
    }
  }

  audioVideoDidStart(): void {
    this.log('session started');
  }

  audioVideoDidStop(sessionStatus: MeetingSessionStatus): void {
    this.log(`session stopped from ${JSON.stringify(sessionStatus)}`);
    this.log(`resetting stats`);
    this.resetStats();

    const returnToStart = () => {
      switch (this.behaviorAfterLeave) {
        case 'spa':
          this.switchToFlow('flow-authenticate');
          break;
        case 'reload':
          window.location.href = window.location.pathname;
          break;
        // This is useful for testing memory leaks.
        case 'halt': {
          // Wait a moment to make sure cleanup is done.
          setTimeout(() => {
            // Kill all references to code and content.
            // @ts-ignore
            window.app = undefined;
            // @ts-ignore
            window.app_meetingV2 = undefined;
            // @ts-ignore
            window.webpackHotUpdateapp_meetingV2 = undefined;
            document.getElementsByTagName('body')[0].innerHTML = '<b>Gone</b>';
            this.removeFatalHandlers();
          }, 2000);
          break;
        }
      }
    };

    /**
     * This is approximately the inverse of the initialization method above.
     * This work only needs to be done if you want to continue using the page; if
     * your app navigates away or closes the tab when done, you can let the browser
     * clean up.
     */
    const cleanUpResources = async () => {
      // Clean up the timers for this.
      this.audioVideo.unsubscribeFromActiveSpeakerDetector(this.activeSpeakerHandler);

      // Stop listening to attendee presence.
      this.audioVideo.realtimeUnsubscribeToAttendeeIdPresence(this.attendeeIdPresenceHandler);

      // Stop listening to transcript events.
      this.audioVideo.transcriptionController?.unsubscribeFromTranscriptEvent(this.transcriptEventHandler);

      // Stop watching device changes in the UI.
      this.audioVideo.removeDeviceChangeObserver(this);

      // Stop content share and local video.
      await this.audioVideo.stopLocalVideoTile();
      await this.audioVideo.stopContentShare();

      // Drop the audio output.
      await this.audioVideo.chooseAudioOutputDevice(null);
      this.audioVideo.unbindAudioElement();

      // remove blur event observer
      this.blurProcessor?.removeObserver(this.blurObserver);

      // remove replacement event observer
      this.replacementProcessor?.removeObserver(this.replacementObserver);

      // Stop any video processor.
      await this.chosenVideoTransformDevice?.stop();

      // Stop Voice Focus.
      await this.voiceFocusDevice?.stop();

      // If you joined and left the meeting, `CleanStoppedSessionTask` will have deselected
      // any input streams. If you didn't, you need to call `chooseAudioInputDevice` here.

      // Clean up the loggers so they don't keep their `onload` listeners around.
      setTimeout(async () => {
        await this.meetingEventPOSTLogger?.destroy();
        await this.meetingSessionPOSTLogger?.destroy();
      }, 500);

      if (isDestroyable(this.eventReporter)) {
        this.eventReporter?.destroy();
      }

      await this.blurProcessor?.destroy();
      await this.replacementProcessor?.destroy();

      this.audioVideo = undefined;
      this.voiceFocusDevice = undefined;
      this.meetingSession = undefined;
      this.activeSpeakerHandler = undefined;
      this.currentAudioInputDevice = undefined;
      this.eventReporter = undefined;
      this.blurProcessor = undefined;
      this.replacementProcessor = undefined;
    };

    const onLeftMeeting = async () => {
      await cleanUpResources();
      returnToStart();
    };

    if (sessionStatus.statusCode() === MeetingSessionStatusCode.AudioCallEnded) {
      this.log(`meeting ended`);
      onLeftMeeting();
      return;
    }

    if (sessionStatus.statusCode() === MeetingSessionStatusCode.Left) {
      this.log('left meeting');
      onLeftMeeting();
      return;
    }
  }

  videoAvailabilityDidChange(availability: MeetingSessionVideoAvailability): void {
    this.canStartLocalVideo = availability.canStartLocalVideo;
    this.log(`video availability changed: canStartLocalVideo  ${availability.canStartLocalVideo}`);
  }

  allowMaxContentShare(): boolean {
    const allowed = new URL(window.location.href).searchParams.get('max-content-share') === 'true';
    if (allowed) {
      return true;
    }
    return false;
  }

  connectionDidBecomePoor(): void {
    this.log('connection is poor');
  }

  connectionDidSuggestStopVideo(): void {
    this.log('suggest turning the video off');
  }

  connectionDidBecomeGood(): void {
    this.log('connection is good now');
  }

  videoSendDidBecomeUnavailable(): void {
    this.log('sending video is not available');
  }

  contentShareDidStart(): void {
    this.log('content share started.');
  }

  contentShareDidStop(): void {
    this.log('content share stopped.');
    if (this.isButtonOn('button-content-share')) {
      this.buttonStates['button-content-share'] = false;
      this.buttonStates['button-pause-content-share'] = false;
      this.displayButtonStates();
      this.updateContentShareDropdown(false);
    }
  }

  contentShareDidPause(): void {
    this.log('content share paused.');
  }

  contentShareDidUnpause(): void {
    this.log(`content share unpaused.`);
  }

  encodingSimulcastLayersDidChange(simulcastLayers: SimulcastLayers): void {
    this.log(
      `current active simulcast layers changed to: ${SimulcastLayerMapping[simulcastLayers]}`
    );
  }

  tileWillBePausedByDownlinkPolicy(tileId: number): void {
    this.log(`Tile ${tileId} will be paused due to insufficient bandwidth`);
    this.videoTileCollection.bandwidthConstrainedTiles.add(tileId);
  }

  tileWillBeUnpausedByDownlinkPolicy(tileId: number): void {
    this.log(`Tile ${tileId} will be resumed due to sufficient bandwidth`);
    this.videoTileCollection.bandwidthConstrainedTiles.delete(tileId);
  }
}

window.addEventListener('load', () => {
  new DemoMeetingApp();
});

window.addEventListener('click', event => {
  const liveTranscriptionModal = document.getElementById('live-transcription-modal');
  if (event.target === liveTranscriptionModal) {
    liveTranscriptionModal.style.display = 'none';
  }
});
