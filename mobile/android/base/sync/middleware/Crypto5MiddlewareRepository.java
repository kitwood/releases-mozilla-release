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
 * The Original Code is Android Sync Client.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Richard Newman <rnewman@mozilla.com>
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

package org.mozilla.gecko.sync.middleware;

import org.mozilla.gecko.sync.crypto.KeyBundle;
import org.mozilla.gecko.sync.repositories.IdentityRecordFactory;
import org.mozilla.gecko.sync.repositories.RecordFactory;
import org.mozilla.gecko.sync.repositories.Repository;
import org.mozilla.gecko.sync.repositories.RepositorySession;
import org.mozilla.gecko.sync.repositories.delegates.RepositorySessionCleanDelegate;
import org.mozilla.gecko.sync.repositories.delegates.RepositorySessionCreationDelegate;

import android.content.Context;

/**
 * Wrap an existing repository in middleware that encrypts and decrypts records
 * passing through.
 *
 * @author rnewman
 *
 */
public class Crypto5MiddlewareRepository extends MiddlewareRepository {

  public RecordFactory recordFactory = new IdentityRecordFactory();

  public class Crypto5MiddlewareRepositorySessionCreationDelegate extends MiddlewareRepository.SessionCreationDelegate {
    private Crypto5MiddlewareRepository repository;
    private RepositorySessionCreationDelegate outerDelegate;

    public Crypto5MiddlewareRepositorySessionCreationDelegate(Crypto5MiddlewareRepository repository, RepositorySessionCreationDelegate outerDelegate) {
      this.repository = repository;
      this.outerDelegate = outerDelegate;
    }
    public void onSessionCreateFailed(Exception ex) {
      this.outerDelegate.onSessionCreateFailed(ex);
    }

    @Override
    public void onSessionCreated(RepositorySession session) {
      // Do some work, then report success with the wrapping session.
      Crypto5MiddlewareRepositorySession cryptoSession;
      try {
        // Synchronous, baby.
        cryptoSession = new Crypto5MiddlewareRepositorySession(session, this.repository, recordFactory);
      } catch (Exception ex) {
        this.outerDelegate.onSessionCreateFailed(ex);
        return;
      }
      this.outerDelegate.onSessionCreated(cryptoSession);
    }
  }

  public KeyBundle keyBundle;
  private Repository inner;

  public Crypto5MiddlewareRepository(Repository inner, KeyBundle keys) {
    super();
    this.inner = inner;
    this.keyBundle = keys;
  }
  @Override
  public void createSession(RepositorySessionCreationDelegate delegate, Context context) {
    Crypto5MiddlewareRepositorySessionCreationDelegate delegateWrapper = new Crypto5MiddlewareRepositorySessionCreationDelegate(this, delegate);
    inner.createSession(delegateWrapper, context);
  }

  @Override
  public void clean(boolean success, RepositorySessionCleanDelegate delegate,
                    Context context) {
    this.inner.clean(success, delegate, context);
  }
}
