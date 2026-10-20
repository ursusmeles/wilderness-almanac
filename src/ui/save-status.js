// Persistence failures live independently of transient action feedback. A
// successful write clears only its own failure, never another storage target's.
export function createSaveStatus(write) {
  const saved = { campaigns: true, preferences: true };
  write({ campaigns: false, preferences: false, message: '' });
  return {
    update(target, success) {
      if (saved[target] === success) return;
      saved[target] = success;
      const campaigns = !saved.campaigns;
      const preferences = !saved.preferences;
      write({
        campaigns,
        preferences,
        message: campaigns
          ? "Your latest campaign changes aren't saved. Download any campaigns you changed before closing this page."
          : preferences
            ? "Your latest settings aren't saved. Keep this page open or try again."
            : '',
      });
    },
  };
}
