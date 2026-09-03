// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { checkBaseUrl, ControlPlaneClient, loadConnection, saveConnection } from '../src/api/controlPlane';
import { githubRepoUrl } from '../src/model/links';

describe('the dock will not hand its credential to an arbitrary origin', () => {
  it('accepts same-origin paths and loopback, refuses anything else', () => {
    expect(checkBaseUrl('/cp').ok).toBe(true);
    expect(checkBaseUrl('http://127.0.0.1:8787').ok).toBe(true);
    expect(checkBaseUrl('http://localhost:8787').ok).toBe(true);
    expect(checkBaseUrl(location.origin).ok).toBe(true);

    const hostile = checkBaseUrl('https://evil.example');
    expect(hostile.ok).toBe(false);
    if (!hostile.ok) expect(hostile.reason).toMatch(/will not send a credential/);

    const scheme = checkBaseUrl('javascript:alert(1)');
    expect(scheme.ok).toBe(false);
    expect(checkBaseUrl('').ok).toBe(false);
    expect(checkBaseUrl('not a url').ok).toBe(false);
  });

  it('refuses at call time, not just in the form', async () => {
    // secret-scan:allow a deliberately fake credential used to prove the base-URL refusal
    const client = new ControlPlaneClient({ baseUrl: 'https://evil.example', token: 'ncp.k-x.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', actorId: 'operator:dock' }, async () => {
      throw new Error('the dock must not reach the network for a refused base URL');
    });
    await expect(client.snapshot()).rejects.toMatchObject({ code: 'DOCK_BASE_URL_REFUSED' });
  });
});

describe('the credential never reaches browser storage', () => {
  it('persists preferences but not the token', () => {
    // secret-scan:allow a deliberately fake credential proving it is not persisted
    saveConnection({ baseUrl: '/cp', token: 'ncp.k-secret.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', actorId: 'operator:dock' });
    const serialized = JSON.stringify({ ...sessionStorage, ...localStorage });
    expect(serialized).not.toContain('ncp.k-secret');
    // It is still available to this page.
    // secret-scan:allow a deliberately fake credential proving it is not persisted
    expect(loadConnection().token).toBe('ncp.k-secret.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    saveConnection({ baseUrl: '/cp', token: '', actorId: 'operator:dock' });
    expect(loadConnection().token).toBe('');
  });
});

describe('untrusted metadata never becomes a link destination', () => {
  it('links only an exact owner/repo', () => {
    expect(githubRepoUrl('notationsystems/Payload-Terminal-V0')).toBe('https://github.com/notationsystems/Payload-Terminal-V0');
    for (const hostile of [
      '../../evil.example',
      'notationsystems/../../evil',
      '//evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'owner/repo?x=1',
      'owner/repo#frag',
      'owner/repo/extra',
      'owner repo',
      '',
      null,
      undefined,
    ]) {
      expect(githubRepoUrl(hostile), String(hostile)).toBeNull();
    }
  });
});

describe('a hostile snapshot cannot inject into the graph tooltip', () => {
  it('renders hostile text as inert content, never as markup or attributes', async () => {
    const { nodeTooltip, linkTooltip } = await import('../src/lenses/graph/render');
    const hostile = {
      id: 'x', name: '<img src=x onerror=alert(1)>', kind: '__proto__', health: '"><script>alert(1)</script>',
      domain: 'd', color: '" onmouseover="alert(1)', ring: 'x', val: 1, capabilities: 1, executeCapabilities: 0,
      located: false, node: {} as never,
    } as never;

    // force-graph assigns these strings to innerHTML, so the real question is what the
    // browser builds from them — not whether a substring survives escaping.
    const render = (html: string) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      return host;
    };

    for (const html of [nodeTooltip(hostile), linkTooltip({ id: 'l', source: 'a', target: 'b', kind: '"><script>x</script>' as never, description: '', relation: {} as never })]) {
      const host = render(html);
      expect(host.querySelector('img'), 'no element may be built from hostile text').toBeNull();
      expect(host.querySelector('script')).toBeNull();
      for (const element of host.querySelectorAll('*')) {
        for (const attribute of element.attributes) {
          expect(attribute.name.startsWith('on'), `event handler ${attribute.name} injected`).toBe(false);
          // Only our own hex constants may reach a style attribute.
          if (attribute.name === 'style') {
            for (const colour of [...attribute.value.matchAll(/color:\s*([^;]+)/g)].map((m) => (m[1] ?? '').trim())) {
              expect(colour, 'colour in a style attribute').toMatch(/^(?:#[0-9a-fA-F]{6}|rgba\([\d.,\s]+\))$/);
            }
          }
        }
      }
    }

    // The hostile name is still shown to the operator, as text.
    expect(render(nodeTooltip(hostile)).textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
