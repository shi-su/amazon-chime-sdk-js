// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import VideoCodecCapability from './VideoCodecCapability';
import SDPCandidateType from './SDPCandidateType';

/**
 * [[SDP]] manages and helps munge an SDP during negotiation.
 */
export default interface SDP {
  /**
   * Clones an SDP
   */
  clone(): SDP;

  /**
   * Splits SDP string into lines
   */
  lines(): string[];

  /**
   * Checks whether the SDP has candidates for any m-line
   */
  hasCandidates(): boolean;

  /**
   * Checks whether the SDP has candidates for all m-lines
   */
  hasCandidatesForAllMLines(): boolean;

  /**
   * Replaces group attribute `a=group:` line with `a=group:BUNDLE audio video`
   */
  withBundleAudioVideo(): SDP;

  /**
   * Copies video sections from other SDP to this SDP
   */
  copyVideo(otherSDP: string): SDP;

  /**
   * Removes candidates of a given type from SDP
   */
  withoutCandidateType(candidateTypeToExclude: SDPCandidateType): SDP;

  /**
   * Removes server reflexive candidate from SDP
   */
  withoutServerReflexiveCandidates(): SDP;

  /**
   * Inserts a parameter to the SDP local offer setting the desired average audio bitrate
   */
  withAudioMaxAverageBitrate(maxAverageBitrate: number): SDP;

  /**
   * Deprecated: `RTCRtpSender.setParameters` has supported setting bitrates for a while and
   * we no longer use this function in other areas of the SDK. Should remove when possible.
   *
   * Inserts a bandwidth limitation attribute to answer SDP for setRemoteDescription and limiting client outbound maximum bitrate
   */
  withBandwidthRestriction(maxBitrateKbps: number, isFirefox: boolean): SDP;

  /**
   * Munges Unified-Plan SDP from different browsers to conform to one format
   */
  withUnifiedPlanFormat(): SDP;

  /**
   * Extracts the ssrc for the sendrecv video media section in SDP
   */
  ssrcForVideoSendingSection(): string;

  /**
   * Returns whether the sendrecv video sections if exist have two different SSRCs in SDPs
   */
  videoSendSectionHasDifferentSSRC(previousSdp: SDP): boolean;

  /**
   * Sorts the codec preferences in video section.
   */
  preferH264IfExists(): SDP;

  /**
   * Removes H.264 from the send section.
   */
  removeH264SupportFromSendSection(): SDP;

  /**
   * List of directions of video sections in order.
   */
  videoSectionDirections(): RTCRtpTransceiverDirection[];

  /**
   * Based off the provided preferences, this function will:
   *   * Reorder the `a=rtpmap` lines so it matches `preferences`. Note they may no longer be grouped with their feedback, which is allowed.
   *   * Reorder the payload types listed in the `m=video` line.
   * 
   * This will be applied to the `a=sendrecv` section so it can be applied on either local or remote SDPs. It can be used to 
   * 'polyfill' `RTCRtpSender.setCodecPreferences' on the local side, but it can also be used on remote SDPs to force the
   * codec actually being send, since the send codec is currently dependent on the remote answer (i.e. `setCodecPreferences` doesn't actually
   * have any impact unless the remote side respects the order of codecs, which would require signaling to be backwards compatible).
   */
  withVideoSendCodecPreferences(preferences: VideoCodecCapability[]): SDP;
}
