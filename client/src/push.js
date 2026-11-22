// Turning notifications on/off for this device (Web Push).
import { api } from './api.js';

const ua = () => navigator.userAgent || '';
export const isIOS = () => /iPad|iPhone|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * 'unsupported' | 'ios-install' (iPhone: add to Home Screen first) | 'denied' | 'off' | 'on'
 */
export async function pushStatus() {
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready.then(() => reg);
}

function keyToBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Must be called from a tap (browsers only ask for permission after a user action). */
export async function turnOnPush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const { publicKey } = await api('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
  return 'on';
}

export async function turnOffPush() {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  return 'off';
}

/** Keep the server's copy fresh (subscriptions can change, or a phone can switch users). */
export async function refreshPushSubscription() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
  } catch { /* not important */ }
}
