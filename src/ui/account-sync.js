import { openDialog } from './dialog-focus.js';
import { createAccountClient } from '../persistence/account-client.js';
import { createCampaignSync } from '../application/campaign-sync.js';
import { exportCampaign, campaignFilename } from '../application/campaigns.js';

export function createAccountPanel({ store, library, client = createAccountClient() }) {
  const dialog = document.getElementById('account-dialog');
  const element = (id) => document.getElementById(`account-${id}`);
  const listeners = new AbortController();
  const listen = (target, type, callback) =>
    target.addEventListener(type, callback, { signal: listeners.signal });
  let user;
  let busy = false;
  let codeEmail;
  const message = (text, error = false) => {
    element('message').textContent = text;
    element('message').dataset.kind = error ? 'error' : 'status';
  };
  const sync = () => createCampaignSync({ client, store, library, accountId: user.id });
  function paintIdentity() {
    element('email-form').hidden = Boolean(user);
    element('code-form').hidden = Boolean(user) || !codeEmail;
    element('campaigns').hidden = !user;
    element('identity').textContent = user?.email || '';
  }
  async function run(work) {
    if (busy) return;
    busy = true;
    dialog.setAttribute('aria-busy', 'true');
    dialog.querySelectorAll('button, input').forEach((control) => {
      control.disabled = true;
    });
    message('Working…');
    try {
      await work();
    } catch (error) {
      message(error.message, true);
    } finally {
      busy = false;
      dialog.removeAttribute('aria-busy');
      dialog.querySelectorAll('button, input').forEach((control) => {
        control.disabled = false;
      });
      paintIdentity();
    }
  }
  function action(text, callback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', () => run(callback), { signal: listeners.signal });
    return button;
  }
  function row(campaign, actions) {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = campaign.name;
    const controls = document.createElement('div');
    controls.className = 'cluster';
    controls.append(...actions);
    item.append(name, controls);
    return item;
  }
  async function download(campaign) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(
      new Blob([exportCampaign(campaign)], { type: 'application/json' }),
    );
    link.href = url;
    link.download = campaignFilename(campaign);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('Campaign download started.');
  }
  async function refresh() {
    const { campaigns } = await client.list();
    const localList = element('local-list');
    localList.replaceChildren(
      ...library.snapshotCampaigns().map((campaign) =>
        row(campaign, [
          action('Save to account', async () => {
            await sync().upload(campaign.id);
            await refresh();
            message(`Saved “${campaign.name}” to your account.`);
          }),
          action('Export local', () => download(campaign)),
        ]),
      ),
    );
    const remoteList = element('remote-list');
    remoteList.replaceChildren(
      ...campaigns.map((campaign) =>
        row(campaign, [
          action('Load on this device', async () => {
            await sync().load(campaign.id);
            await refresh();
            message(`Loaded “${campaign.name}” on this device.`);
          }),
          action('Import as copy', async () => {
            await sync().load(campaign.id, { asCopy: true });
            await refresh();
            message(`Imported a separate copy of “${campaign.name}”.`);
          }),
          action('Export account copy', async () =>
            download((await client.get(campaign.id)).campaign),
          ),
          action('Delete account copy', async () => {
            if (
              !window.confirm(
                `Delete the account copy of “${campaign.name}”? Local campaigns will be kept.`,
              )
            ) {
              message('Deletion cancelled.');
              return;
            }
            await client.remove(campaign.id, campaign.revision);
            await refresh();
            message('Account copy deleted. Local campaigns have been kept.');
          }),
        ]),
      ),
    );
    if (!localList.children.length) localList.textContent = 'No local campaigns yet.';
    if (!remoteList.children.length) remoteList.textContent = 'No account campaigns yet.';
  }
  listen(document.getElementById('close-account'), 'click', () => {
    if (!busy) dialog.close();
  });
  listen(dialog, 'cancel', (event) => {
    if (busy) event.preventDefault();
  });
  listen(element('email-form'), 'submit', (event) => {
    event.preventDefault();
    const email = element('email').value.trim();
    void run(async () => {
      await client.sendCode(email);
      codeEmail = email;
      element('code-form').hidden = false;
      element('code').value = '';
      element('send-code').textContent = 'Resend sign-in code';
      message('Check your email. The code expires in five minutes.');
    }).then(() => {
      if (codeEmail) element('code').focus();
    });
  });
  listen(element('code-form'), 'submit', (event) => {
    event.preventDefault();
    const otp = element('code').value.trim();
    void run(async () => {
      await client.signIn(codeEmail, otp);
      element('code').value = '';
      user = (await client.session())?.user;
      if (!user) throw new Error('Sign-in could not be confirmed. Retry signing in.');
      await refresh();
      message('Signed in. Choose which campaigns to save or load.');
    });
  });
  listen(element('sign-out'), 'click', () =>
    run(async () => {
      await client.signOut();
      user = undefined;
      codeEmail = undefined;
      element('code').value = '';
      element('local-list').replaceChildren();
      element('remote-list').replaceChildren();
      message('Signed out. Local campaigns stay on this device.');
    }),
  );
  listen(element('refresh'), 'click', () =>
    run(async () => {
      await refresh();
      message('Account copies refreshed.');
    }),
  );
  return {
    async open() {
      openDialog(dialog);
      await run(async () => {
        user = (await client.session())?.user;
        paintIdentity();
        if (user) await refresh();
        message('');
      });
      (user ? element('refresh') : element('email')).focus();
    },
    dispose() {
      listeners.abort();
      if (dialog.open) dialog.close();
    },
  };
}
