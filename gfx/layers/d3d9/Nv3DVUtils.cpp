/* -*- Mode: C++; tab-width: 20; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * ***** BEGIN LICENSE BLOCK *****
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
 * The Original Code is NVIDIA Corporation Code.
 *
 * The Initial Developer of the Original Code is NVIDIA Corporation.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Atul Apte <aapte135@gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
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

#include "nsIServiceManager.h"
#include "nsIConsoleService.h"
#include <initguid.h>
#include "Nv3DVUtils.h"
#include "mozilla/Util.h"

DEFINE_GUID(CLSID_NV3DVStreaming, 
0xf7747266, 0x777d, 0x4f61, 0xa1, 0x75, 0xdd, 0x5a, 0xdf, 0x1e, 0x37, 0xdf);

DEFINE_GUID(IID_INV3DVStreaming, 
0xf98f9bb2, 0xb914, 0x4d44, 0x98, 0xfa, 0x6e, 0x37, 0x85, 0x16, 0x98, 0x55);

namespace mozilla {
namespace layers {

/**
 * Constructor and Destructor
 */
Nv3DVUtils::Nv3DVUtils()
  : m3DVStreaming (NULL)
{
}

Nv3DVUtils::~Nv3DVUtils()
{
  UnInitialize();
}

/**
 * Initializes the Nv3DVUtils object.
 */
void
Nv3DVUtils::Initialize()
{
  /*
   * Detect if 3D Streaming object is already loaded. Do nothing in that case.
   */
  if (m3DVStreaming) {
    NS_WARNING("Nv3DVStreaming COM object already instantiated.\n");
    return;
  }

  /*
   * Create the COM object. If we fail at any stage, just return
   */
  HRESULT hr = CoCreateInstance(CLSID_NV3DVStreaming, NULL, CLSCTX_INPROC_SERVER, IID_INV3DVStreaming, (void**)(getter_AddRefs(m3DVStreaming)));
  if (FAILED(hr) || !m3DVStreaming) {
    NS_WARNING("Nv3DVStreaming CoCreateInstance failed (disabled).");
    return;
  }

  /*
   * Initialize the object. Note that m3DVStreaming cannot be NULL at this point.
   */
  bool bRetVal = m3DVStreaming->Nv3DVInitialize();

  if (!bRetVal) {
    NS_WARNING("Nv3DVStreaming Nv3DVInitialize failed!");
    return;
  }
}

/**
 * Release resources used by the COM Object, and then release 
 * the COM Object (nsRefPtr gets released by setting to NULL) 
 *
 */
void
Nv3DVUtils::UnInitialize()
{
  if (m3DVStreaming) {
    m3DVStreaming->Nv3DVRelease();
  }
}

/**
 * Sets the device info, along with any other initialization that is needed after device creation
 * Pass the D3D9 device pointer is an IUnknown input argument.
 */
void 
Nv3DVUtils::SetDeviceInfo(IUnknown *devUnknown)
{
  if (!devUnknown) {
    NS_WARNING("D3D Device Pointer (IUnknown) is NULL.\n");
    return;
  }

  if (!m3DVStreaming) {
      return;
  }

  bool rv = m3DVStreaming->Nv3DVSetDevice(devUnknown);
  if (!rv) {
      NS_WARNING("Nv3DVStreaming Nv3DVControl failed!");
      return;
  }

  rv = m3DVStreaming->Nv3DVControl(NV_STEREO_MODE_RIGHT_LEFT, true, FIREFOX_3DV_APP_HANDLE);
  NS_WARN_IF_FALSE(rv, "Nv3DVStreaming Nv3DVControl failed!");
}

/*
 * Send Stereo Control Information. Used mainly to re-route 
 * calls from ImageLayerD3D9 to the 3DV COM object
 */
void 
Nv3DVUtils::SendNv3DVControl(Nv_Stereo_Mode eStereoMode, bool bEnableStereo, DWORD dw3DVAppHandle)
{
  if (!m3DVStreaming)
      return;

  DebugOnly<bool> rv = m3DVStreaming->Nv3DVControl(eStereoMode, bEnableStereo, dw3DVAppHandle);
  NS_WARN_IF_FALSE(rv, "Nv3DVStreaming Nv3DVControl failed!");
}

/*
 * Send Stereo Metadata. Used mainly to re-route calls 
 * from ImageLayerD3D9 to the 3DV COM object
 */
void 
Nv3DVUtils::SendNv3DVMetaData(unsigned int dwWidth, unsigned int dwHeight, HANDLE hSrcLuma, HANDLE hDst)
{
  if (!m3DVStreaming)
      return;

  DebugOnly<bool> rv = m3DVStreaming->Nv3DVMetaData((DWORD)dwWidth, (DWORD)dwHeight, hSrcLuma, hDst);
  NS_WARN_IF_FALSE(rv, "Nv3DVStreaming Nv3DVMetaData failed!");
}

} /* namespace layers */
} /* namespace mozilla */
