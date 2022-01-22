// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * `VideoCodecCapability` represents a higher level type to wrap `RTCRtpCodecCapability`
 * and the codec name used in the SDP, while also namespacing static create functions
 * for codecs supported in the SDK.
 * 
 * Note that `codecName` is different then `codecCapability.mimeType`
 */
export default class VideoCodecCapability {
  private constructor(
    readonly codecName: string,
    readonly codecCapability: RTCRtpCodecCapability) { }

  /**
   * Returns the configuration of VP8 supported by the SDK
   */
  static vp8() {
    return new VideoCodecCapability('VP8', {
      clockRate: 90000,
      mimeType: 'video/VP8',
    });
  }

  /**
   * Returns the configuration of H.264 CBP supported by the SDK
   */
  static h264ConstrainedBaselineProfile() {
    return new VideoCodecCapability('H264', {
      clockRate: 90000,
      mimeType: 'video/H264',
      sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'
    });
  }

  /**
   * Returns the configuration of VP9 supported by the SDK
   */
  static vp9Profile0() {
    return new VideoCodecCapability('VP9', {
      clockRate: 90000,
      mimeType: 'video/VP9',
      sdpFmtpLine: 'profile-id=0'
    });
  }

 /**
  * Returns the configuration of VP9 supported by the SDK
  */
  static vp9Profile1() {
    return new VideoCodecCapability('VP9', {
      clockRate: 90000,
      mimeType: 'video/VP9',
      sdpFmtpLine: 'profile-id=1'
    });
  }

  /**
   * Returns the configuration of VP9 supported by the SDK
   */
  static vp9Profile2() {
    return new VideoCodecCapability('VP9', {
      clockRate: 90000,
      mimeType: 'video/VP9',
      sdpFmtpLine: 'profile-id=2'
    });
  }

  /**
   * Returns the configuration of VP9 supported by the SDK
   */
  static vp9() {
    return this.vp9Profile0();
  }

  /**
   * Returns the configuration of AV1 supported by the SDK
   */
  static av1MainProfile() {
    return new VideoCodecCapability('AV1', {
      clockRate: 90000,
      mimeType: 'video/AV1',
    });
  }

  static av1() {
    return this.av1MainProfile();
  }
}
