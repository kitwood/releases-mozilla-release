/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set sw=2 ts=8 et tw=80 : */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla.
 *
 * The Initial Developer of the Original Code is
 * Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2010 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Wellington Fernando de Macedo <wfernandom2004@gmail.com> (original author)
 *   Patrick McManus <mcmanus@ducksong.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either of the GNU General Public License Version 2 or later (the "GPL"),
 * or the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

#ifndef mozilla_net_WebSocketChannel_h
#define mozilla_net_WebSocketChannel_h

#include "nsIURI.h"
#include "nsISupports.h"
#include "nsIInterfaceRequestor.h"
#include "nsIEventTarget.h"
#include "nsIStreamListener.h"
#include "nsIProtocolHandler.h"
#include "nsISocketTransport.h"
#include "nsIAsyncInputStream.h"
#include "nsIAsyncOutputStream.h"
#include "nsILoadGroup.h"
#include "nsITimer.h"
#include "nsIDNSListener.h"
#include "nsIHttpChannel.h"
#include "nsIChannelEventSink.h"
#include "nsIAsyncVerifyRedirectCallback.h"
#include "nsIStringStream.h"
#include "nsIHttpChannelInternal.h"
#include "nsIRandomGenerator.h"
#include "BaseWebSocketChannel.h"

#include "nsCOMPtr.h"
#include "nsString.h"
#include "nsDeque.h"

namespace mozilla { namespace net {

class OutboundMessage;
class OutboundEnqueuer;
class nsWSAdmissionManager;
class nsWSCompression;
class CallOnMessageAvailable;
class CallOnStop;
class CallOnServerClose;
class CallAcknowledge;

class WebSocketChannel : public BaseWebSocketChannel,
                         public nsIHttpUpgradeListener,
                         public nsIStreamListener,
                         public nsIInputStreamCallback,
                         public nsIOutputStreamCallback,
                         public nsITimerCallback,
                         public nsIDNSListener,
                         public nsIInterfaceRequestor,
                         public nsIChannelEventSink
{
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIHTTPUPGRADELISTENER
  NS_DECL_NSIREQUESTOBSERVER
  NS_DECL_NSISTREAMLISTENER
  NS_DECL_NSIINPUTSTREAMCALLBACK
  NS_DECL_NSIOUTPUTSTREAMCALLBACK
  NS_DECL_NSITIMERCALLBACK
  NS_DECL_NSIDNSLISTENER
  NS_DECL_NSIINTERFACEREQUESTOR
  NS_DECL_NSICHANNELEVENTSINK

  // nsIWebSocketChannel methods BaseWebSocketChannel didn't implement for us
  //
  NS_IMETHOD AsyncOpen(nsIURI *aURI,
                       const nsACString &aOrigin,
                       nsIWebSocketListener *aListener,
                       nsISupports *aContext);
  NS_IMETHOD Close(PRUint16 aCode, const nsACString & aReason);
  NS_IMETHOD SendMsg(const nsACString &aMsg);
  NS_IMETHOD SendBinaryMsg(const nsACString &aMsg);
  NS_IMETHOD SendBinaryStream(nsIInputStream *aStream, PRUint32 length);
  NS_IMETHOD GetSecurityInfo(nsISupports **aSecurityInfo);

  WebSocketChannel();
  static void Shutdown();

  enum {
    // Non Control Frames
    kContinuation = 0x0,
    kText =         0x1,
    kBinary =       0x2,

    // Control Frames
    kClose =        0x8,
    kPing =         0x9,
    kPong =         0xA
  };

  const static PRUint32 kControlFrameMask   = 0x8;
  const static PRUint8 kMaskBit             = 0x80;
  const static PRUint8 kFinalFragBit        = 0x80;

protected:
  virtual ~WebSocketChannel();

private:
  friend class OutboundEnqueuer;
  friend class nsWSAdmissionManager;
  friend class CallOnMessageAvailable;
  friend class CallOnStop;
  friend class CallOnServerClose;
  friend class CallAcknowledge;

  // Common send code for binary + text msgs
  nsresult SendMsgCommon(const nsACString *aMsg, bool isBinary,
                         PRUint32 length, nsIInputStream *aStream = NULL);

  void EnqueueOutgoingMessage(nsDeque &aQueue, OutboundMessage *aMsg);

  void PrimeNewOutgoingMessage();
  void DeleteCurrentOutGoingMessage();
  void GeneratePong(PRUint8 *payload, PRUint32 len);
  void GeneratePing();

  nsresult BeginOpen();
  nsresult HandleExtensions();
  nsresult SetupRequest();
  nsresult ApplyForAdmission();
  nsresult StartWebsocketData();
  PRUint16 ResultToCloseCode(nsresult resultCode);

  void StopSession(nsresult reason);
  void AbortSession(nsresult reason);
  void ReleaseSession();
  void CleanupConnection();
  void IncrementSessionCount();
  void DecrementSessionCount();

  void EnsureHdrOut(PRUint32 size);
  void ApplyMask(PRUint32 mask, PRUint8 *data, PRUint64 len);

  bool     IsPersistentFramePtr();
  nsresult ProcessInput(PRUint8 *buffer, PRUint32 count);
  bool UpdateReadBuffer(PRUint8 *buffer, PRUint32 count,
                        PRUint32 accumulatedFragments,
                        PRUint32 *available);


  nsCOMPtr<nsIEventTarget>                 mSocketThread;
  nsCOMPtr<nsIHttpChannelInternal>         mChannel;
  nsCOMPtr<nsIHttpChannel>                 mHttpChannel;
  nsCOMPtr<nsICancelable>                  mDNSRequest;
  nsCOMPtr<nsIAsyncVerifyRedirectCallback> mRedirectCallback;
  nsCOMPtr<nsIRandomGenerator>             mRandomGenerator;

  nsCString                       mHashedSecret;
  nsCString                       mAddress;

  nsCOMPtr<nsISocketTransport>    mTransport;
  nsCOMPtr<nsIAsyncInputStream>   mSocketIn;
  nsCOMPtr<nsIAsyncOutputStream>  mSocketOut;

  nsCOMPtr<nsITimer>              mCloseTimer;
  PRUint32                        mCloseTimeout;  /* milliseconds */

  nsCOMPtr<nsITimer>              mOpenTimer;
  PRUint32                        mOpenTimeout;  /* milliseconds */

  nsCOMPtr<nsITimer>              mPingTimer;
  PRUint32                        mPingTimeout;  /* milliseconds */
  PRUint32                        mPingResponseTimeout;  /* milliseconds */

  nsCOMPtr<nsITimer>              mLingeringCloseTimer;
  const static PRInt32            kLingeringCloseTimeout =   1000;
  const static PRInt32            kLingeringCloseThreshold = 50;

  PRInt32                         mMaxConcurrentConnections;

  PRUint32                        mRecvdHttpOnStartRequest   : 1;
  PRUint32                        mRecvdHttpUpgradeTransport : 1;
  PRUint32                        mRequestedClose            : 1;
  PRUint32                        mClientClosed              : 1;
  PRUint32                        mServerClosed              : 1;
  PRUint32                        mStopped                   : 1;
  PRUint32                        mCalledOnStop              : 1;
  PRUint32                        mPingOutstanding           : 1;
  PRUint32                        mAllowCompression          : 1;
  PRUint32                        mAutoFollowRedirects       : 1;
  PRUint32                        mReleaseOnTransmit         : 1;
  PRUint32                        mTCPClosed                 : 1;
  PRUint32                        mOpenBlocked               : 1;
  PRUint32                        mOpenRunning               : 1;
  PRUint32                        mChannelWasOpened          : 1;
  PRUint32                        mIncrementedSessionCount   : 1;
  PRUint32                        mDecrementedSessionCount   : 1;

  PRInt32                         mMaxMessageSize;
  nsresult                        mStopOnClose;
  PRUint16                        mServerCloseCode;
  nsCString                       mServerCloseReason;
  PRUint16                        mScriptCloseCode;
  nsCString                       mScriptCloseReason;

  // These are for the read buffers
  const static PRUint32 kIncomingBufferInitialSize = 16 * 1024;
  // We're ok with keeping a buffer this size or smaller around for the life of
  // the websocket.  If a particular message needs bigger than this we'll
  // increase the buffer temporarily, then drop back down to this size.
  const static PRUint32 kIncomingBufferStableSize = 128 * 1024;

  PRUint8                        *mFramePtr;
  PRUint8                        *mBuffer;
  PRUint8                         mFragmentOpcode;
  PRUint32                        mFragmentAccumulator;
  PRUint32                        mBuffered;
  PRUint32                        mBufferSize;
  nsCOMPtr<nsIStreamListener>     mInflateReader;
  nsCOMPtr<nsIStringInputStream>  mInflateStream;

  // These are for the send buffers
  const static PRInt32 kCopyBreak = 1000;

  OutboundMessage                *mCurrentOut;
  PRUint32                        mCurrentOutSent;
  nsDeque                         mOutgoingMessages;
  nsDeque                         mOutgoingPingMessages;
  nsDeque                         mOutgoingPongMessages;
  PRUint32                        mHdrOutToSend;
  PRUint8                        *mHdrOut;
  PRUint8                         mOutHeader[kCopyBreak + 16];
  nsWSCompression                *mCompressor;
  PRUint32                        mDynamicOutputSize;
  PRUint8                        *mDynamicOutput;
};

class WebSocketSSLChannel : public WebSocketChannel
{
public:
    WebSocketSSLChannel() { BaseWebSocketChannel::mEncrypted = true; }
protected:
    virtual ~WebSocketSSLChannel() {}
};

}} // namespace mozilla::net

#endif // mozilla_net_WebSocketChannel_h
