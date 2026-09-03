// Nickland Edusoft — the school's own identity, in the app.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The crest was uploaded on the desktop years ago and has never once appeared
// on a phone, because the API sent the FILE PATH it was stored under and a
// phone has no such file. The server now sends the image itself; this fetches
// it once per session and hands it to whatever wants to draw it.
//
// It is deliberately public and fetched before sign-in: the first screen a
// parent sees should be their school, not a generic blue rectangle that could
// belong to anybody. It is also deliberately forgiving — a school that has not
// uploaded a crest, or an older desktop with no /branding route at all, gets
// the app it always had rather than an error.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { channels as contactChannels } from './contact';

const BrandCtx = createContext({ ready: false, school: null, contact: {}, logo: null, channels: [] });

export function useBranding() { return useContext(BrandCtx); }

export function BrandingProvider({ host, children }) {
  const [state, setState] = useState({ ready: false, school: null, contact: {}, logo: null, channels: [] });

  const load = useCallback(async () => {
    if (!host) { setState(s => ({ ...s, ready: true })); return; }
    try {
      const r = await api.branding();
      setState({
        ready: true,
        school: r.school || null,
        contact: r.contact || {},
        logo: r.logo || null,
        currency: r.currency || 'GHS',
        channels: contactChannels(r.contact || {}),
      });
    } catch (_) {
      // An older school desktop has no /branding. Fall back to /info, which
      // every version has answered since the first release: it carries the
      // name and a phone number, which is enough for a chat button.
      try {
        const i = await api.info();
        const contact = { phone: i.school?.phone || '', whatsapp: i.school?.phone || '' };
        setState({
          ready: true,
          school: i.school || null,
          contact,
          logo: null,
          currency: i.payment_currency || 'GHS',
          channels: contactChannels(contact),
        });
      } catch (__) {
        setState(s => ({ ...s, ready: true }));
      }
    }
  }, [host]);

  useEffect(() => { load(); }, [load]);

  return <BrandCtx.Provider value={{ ...state, reload: load }}>{children}</BrandCtx.Provider>;
}

export default BrandingProvider;
