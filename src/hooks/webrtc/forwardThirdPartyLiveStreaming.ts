import { ref } from 'vue';

import { fetchRtcV1Publish } from '@/api/srs';
import { fetchTencentcloudCssPush } from '@/api/tencentcloudCss';
import { SRS_CB_URL_QUERY } from '@/constant';
import { useRTCParams } from '@/hooks/use-rtcParams';
import { SwitchEnum } from '@/interface';
import { useNetworkStore } from '@/store/network';
import { useUserStore } from '@/store/user';
import { LiveRoomTypeEnum } from '@/types/ILiveRoom';
import { WebRTCClass } from '@/utils/network/webRTC';

export function useForwardThirdPartyLiveStreaming() {
  const userStore = useUserStore();
  const networkStore = useNetworkStore();
  const { maxBitrate, maxFramerate, resolutionRatio } = useRTCParams();
  const currentMaxBitrate = ref(maxBitrate.value[3].value);
  const currentMaxFramerate = ref(maxFramerate.value[2].value);
  const currentResolutionRatio = ref(resolutionRatio.value[3].value);
  const isPk = ref(false);
  const roomId = ref('');
  const canvasVideoStream = ref<MediaStream>();
  const cdn = ref<SwitchEnum>();
  const isdev = ref<string>('2');
  const liveRoomType = ref<LiveRoomTypeEnum>();

  function updateForwardThirdPartyLiveStreamingConfig(data: {
    cdn: SwitchEnum;
    isdev: string;
    liveRoomType: LiveRoomTypeEnum;
    isPk;
    roomId;
    canvasVideoStream;
  }) {
    cdn.value = data.cdn;
    isdev.value = data.isdev;
    liveRoomType.value = data.liveRoomType;
    isPk.value = data.isPk;
    roomId.value = data.roomId;
    canvasVideoStream.value = data.canvasVideoStream;
  }

  const forwardThirdPartyLiveStreaming = {
    newWebRtc: (data: {
      sender: string;
      receiver: string;
      videoEl: HTMLVideoElement;
    }) => {
      return new WebRTCClass({
        maxBitrate: currentMaxBitrate.value,
        maxFramerate: currentMaxFramerate.value,
        resolutionRatio: currentResolutionRatio.value,
        isSRS: true,
        roomId: roomId.value,
        videoEl: data.videoEl,
        sender: data.sender,
        receiver: data.receiver,
      });
    },
    /**
     * 主播发offer给观众
     */
    sendOffer: async ({
      sender,
      receiver,
    }: {
      sender: string;
      receiver: string;
    }) => {
      console.log('开始ForwardThirdPartyLiveStreaming的sendOffer', {
        sender,
        receiver,
      });
      try {
        const liveRooms = userStore.userInfo?.live_rooms;
        const myLiveRoom = liveRooms?.[0];
        if (!myLiveRoom) {
          window.$message.error('你没有开通直播间');
          return;
        }
        const ws = networkStore.wsMap.get(roomId.value);
        if (!ws) return;
        const rtc = networkStore.rtcMap.get(receiver);
        if (rtc) {
          canvasVideoStream.value?.getTracks().forEach((track) => {
            if (canvasVideoStream.value) {
              console.log(
                'ForwardThirdPartyLiveStreaming的canvasVideoStream插入track',
                track.kind,
                track
              );
              rtc.peerConnection?.addTrack(track, canvasVideoStream.value);
            }
          });
          const offerSdp = await rtc.createOffer();
          if (!offerSdp) {
            console.error('ForwardThirdPartyLiveStreaming的offerSdp为空');
            window.$message.error(
              'ForwardThirdPartyLiveStreaming的offerSdp为空'
            );
            return;
          }
          await rtc.setLocalDescription(offerSdp!);
          if (cdn.value === SwitchEnum.no) {
            const answerRes = await fetchRtcV1Publish({
              sdp: offerSdp.sdp!,
              streamurl: `${myLiveRoom.pull_rtmp_url!}?${
                SRS_CB_URL_QUERY.publishKey
              }=${myLiveRoom.key!}&${SRS_CB_URL_QUERY.publishType}=${
                isPk.value ? LiveRoomTypeEnum.pk : liveRoomType.value!
              }&${SRS_CB_URL_QUERY.userId}=${userStore.userInfo?.id!}&${
                SRS_CB_URL_QUERY.isdev
              }=${isdev.value}`,
            });
            if (answerRes.data.code !== 0) {
              console.error('/rtc/v1/publish/拿不到sdp');
              window.$message.error('/rtc/v1/publish/拿不到sdp');
              return;
            }
            await rtc.setRemoteDescription(
              new RTCSessionDescription({
                type: 'answer',
                sdp: answerRes.data.sdp,
              })
            );
          } else {
            const res = await fetchTencentcloudCssPush(myLiveRoom.id!);
            if (res.code === 200) {
              const livePusher = new window.TXLivePusher();
              // https://cloud.tencent.com/document/product/267/92713#1a9164cf-9f99-47d5-9667-ea558886cb9f
              // 使用用户自定义的音视频流。
              await livePusher.startCustomCapture(canvasVideoStream.value);
              const pushurl = res.data.webrtc_url
                ?.replace(/&isdev=\w+/g, `&isdev=${isdev.value}`)
                .replace(/&pushtype=\w+/g, `&pushtype=${liveRoomType.value!}`);
              livePusher.startPush(pushurl);
            }
          }
        } else {
          console.error('rtc不存在');
        }
      } catch (error) {
        console.error('ForwardThirdPartyLiveStreaming的sendOffer错误');
        console.log(error);
      }
    },
  };

  return {
    updateForwardThirdPartyLiveStreamingConfig,
    forwardThirdPartyLiveStreaming,
  };
}