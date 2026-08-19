'use client';

import { useState, useTransition } from 'react';
import type { CustomDomain } from '@/lib/api';
import { addDomainAction, verifyDomainAction, deleteDomainAction } from '@/lib/actions';

type Props = { initial: CustomDomain[]; cnameTarget: string };

export function DomainsPanel({ initial, cnameTarget }: Props) {
  const [items, setItems] = useState<CustomDomain[]>(initial);
  const [hostname, setHostname] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, string>>({});
  const [isAdding, startAdd] = useTransition();
  const [isVerifying, startVerify] = useTransition();

  function add() {
    setAddError(null);
    const h = hostname.trim().toLowerCase();
    if (!h) return;
    startAdd(async () => {
      const res = await addDomainAction(h);
      if ('error' in res && res.error) { setAddError(res.error); return; }
      if ('domain' in res && res.domain) {
        setItems((prev) => [...prev, res.domain!]);
        setHostname('');
      }
    });
  }

  function verify(id: string) {
    setVerifyResults((prev) => ({ ...prev, [id]: 'Checking DNS…' }));
    startVerify(async () => {
      const res = await verifyDomainAction(id);
      if ('error' in res && res.error) {
        setVerifyResults((prev) => ({ ...prev, [id]: `Error: ${res.error}` }));
        return;
      }
      if ('ok' in res && res.ok) {
        setVerifyResults((prev) => ({
          ...prev,
          [id]: `Verified. ${res.ssl?.message ?? ''}`,
        }));
        setItems((prev) => prev.map((d) => (
          d.id === id
            ? {
                ...d,
                verifiedAt: new Date().toISOString(),
                sslStatus: (res.ssl?.ok ? 'active' : 'error') as CustomDomain['sslStatus'],
                sslProvider: res.ssl?.provider ?? null,
              }
            : d
        )));
      } else if ('message' in res && res.message) {
        setVerifyResults((prev) => ({ ...prev, [id]: `${res.step === 'cname' ? 'CNAME' : 'TXT'}: ${res.message}` }));
      }
    });
  }

  function remove(id: string) {
    if (!confirm('Disconnect this domain? Visitors on the custom URL will stop reaching your KB.')) return;
    setItems((prev) => prev.filter((d) => d.id !== id));
    startVerify(() => { void deleteDomainAction(id); });
  }

  return (
    <div className="space-y-6">
      {/* Existing domains */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No custom domains yet.</p>
        ) : items.map((d) => {
          const verified = !!d.verifiedAt;
          const txtHost = `_telecomm.${d.hostname}`;
          const txtValue = `telecomm-verify=${d.verificationToken}`;
          return (
            <div key={d.id} className="p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-mono font-medium text-gray-900 break-all">{d.hostname}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      verified
                        ? d.sslStatus === 'active' ? 'bg-emerald-100 text-emerald-700'
                          : d.sslStatus === 'error' ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {verified ? `SSL ${d.sslStatus}` : 'unverified'}
                    </span>
                    {d.sslProvider && (
                      <span className="text-[10px] text-gray-500">via {d.sslProvider}</span>
                    )}
                  </div>
                  {d.sslError && (
                    <p className="text-xs text-rose-600 mt-1">{d.sslError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => verify(d.id)}
                    disabled={isVerifying}
                    className="text-xs px-2.5 py-1 border border-indigo-200 text-indigo-700 rounded hover:bg-indigo-50 disabled:opacity-60"
                  >
                    {verified ? 'Re-check' : 'Verify'}
                  </button>
                  <button
                    onClick={() => remove(d.id)}
                    className="text-xs px-2.5 py-1 border border-rose-200 text-rose-700 rounded hover:bg-rose-50"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {!verified && (
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Set up DNS</p>

                  <div>
                    <p className="text-[11px] text-gray-500 mb-1">Add a CNAME record</p>
                    <table className="text-xs font-mono w-full">
                      <tbody>
                        <tr>
                          <td className="text-gray-500 py-1 pr-4">Type</td>
                          <td>CNAME</td>
                        </tr>
                        <tr>
                          <td className="text-gray-500 py-1 pr-4">Name</td>
                          <td className="break-all">{d.hostname.split('.')[0]}</td>
                        </tr>
                        <tr>
                          <td className="text-gray-500 py-1 pr-4">Target</td>
                          <td className="break-all">{cnameTarget}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="pt-3 border-t border-gray-200">
                    <p className="text-[11px] text-gray-500 mb-1">And a TXT record for ownership</p>
                    <table className="text-xs font-mono w-full">
                      <tbody>
                        <tr>
                          <td className="text-gray-500 py-1 pr-4">Type</td>
                          <td>TXT</td>
                        </tr>
                        <tr>
                          <td className="text-gray-500 py-1 pr-4">Name</td>
                          <td className="break-all">{txtHost}</td>
                        </tr>
                        <tr>
                          <td className="text-gray-500 py-1 pr-4">Value</td>
                          <td className="break-all">{txtValue}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <p className="text-[11px] text-gray-500">
                    DNS changes usually propagate in a few minutes. Once both records are live, click <strong>Verify</strong>.
                  </p>
                </div>
              )}

              {verifyResults[d.id] && (
                <p className="mt-3 text-xs" style={{ color: verifyResults[d.id].startsWith('Verified') ? '#059669' : '#b45309' }}>
                  {verifyResults[d.id]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Add new */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Connect a new domain</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={hostname}
            onChange={(e) => setHostname(e.currentTarget.value)}
            placeholder="help.yourbrand.com"
            className="flex-1 text-sm border border-gray-200 rounded px-3 py-2 font-mono"
          />
          <button
            onClick={add}
            disabled={isAdding}
            className="text-sm px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60"
          >
            {isAdding ? 'Adding…' : 'Add domain'}
          </button>
        </div>
        {addError && <p className="text-sm text-rose-600">{addError}</p>}
        <p className="text-[11px] text-gray-500">
          Use a subdomain like <code>help.brand.com</code>. Apex domains
          (e.g. <code>brand.com</code>) can&apos;t be CNAME&apos;d on most DNS providers.
        </p>
      </div>

      {/* How it works */}
      <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-5 text-xs text-indigo-900 space-y-2">
        <p className="font-semibold">How custom domains work</p>
        <p>
          You add a <strong>CNAME</strong> pointing your subdomain at{' '}
          <code className="font-mono">{cnameTarget}</code>, and a{' '}
          <strong>TXT ownership record</strong> we generate for you. Once DNS resolves, we
          verify both, then hand off to <strong>Cloudflare-for-SaaS</strong> to issue a
          TLS certificate. Cloudflare terminates SSL at their edge and forwards the request
          to our origin — the visitor sees your domain with a valid cert, and your KB loads
          seamlessly.
        </p>
        <p className="text-indigo-700">
          In this environment SSL is stubbed — set <code>CF_API_TOKEN</code> and{' '}
          <code>CF_ZONE_ID</code> on the API service (or wire the Let&apos;s Encrypt path in
          <code>domain-verify.ts</code>) to enable real cert issuance.
        </p>
      </div>
    </div>
  );
}
