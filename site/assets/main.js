/* MaikNote site — vanilla JS, no dependencies. */
(() => {
  const REPO = 'Aprilming/maiknote';
  const RELEASE_PAGE = 'https://github.com/' + REPO + '/releases/latest';

  /* ---------- theme ---------- */
  const root = document.documentElement;
  const stored = localStorage.getItem('mn-theme');
  root.dataset.theme = stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem('mn-theme', next);
  });

  /* ---------- sticky nav border ---------- */
  const nav = document.getElementById('nav');
  const onScroll = () => nav?.classList.toggle('is-stuck', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- copy to clipboard ---------- */
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = document.querySelector(btn.dataset.copy);
      if (!target) return;
      const text = target.textContent;
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const label = btn.textContent;
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => { btn.textContent = label; }, 1600);
    });
  });

  /* ---------- resolve latest release assets ---------- */
  // 版本号只从 GitHub Releases 读，HTML 里不写死任何版本；拿到之前整段隐藏。
  const setVersion = (v) => {
    if (!v) return;
    document.querySelectorAll('[data-version]').forEach((el) => { el.textContent = v; });
    document.querySelectorAll('[data-ver-wrap]').forEach((el) => { el.hidden = false; });
  };

  const applyAsset = (arch, url) => {
    document.querySelectorAll('[data-download="' + arch + '"]').forEach((a) => {
      a.href = url;
    });
  };

  const resolveRelease = async () => {
    let release = null;
    try {
      const cached = sessionStorage.getItem('mn-release');
      if (cached) release = JSON.parse(cached);
    } catch { /* ignore bad cache */ }

    if (!release) {
      try {
        const res = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (res.ok) {
          release = await res.json();
          sessionStorage.setItem('mn-release', JSON.stringify(release));
        }
      } catch { /* offline or rate limited: keep the release page links */ }
    }

    if (!release || !Array.isArray(release.assets)) return;

    setVersion(String(release.tag_name || '').replace(/^v/, ''));
    const find = (re) => release.assets.find((a) => re.test(a.name));
    const arm = find(/aarch64\.dmg$/i) || find(/arm64\.dmg$/i);
    const intel = find(/x64\.dmg$/i) || find(/x86_64\.dmg$/i);
    if (arm) applyAsset('arm64', arm.browser_download_url);
    if (intel) applyAsset('x64', intel.browser_download_url);
  };

  resolveRelease();

  /* ---------- reveal on scroll ---------- */
  const targets = Array.from(document.querySelectorAll('.idea, .card, .window, .dl-card, .install, .faq details, .key-row'));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reduce && 'IntersectionObserver' in window) {
    targets.forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = Math.min(i % 6, 5) * 55 + 'ms';
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach((el) => io.observe(el));
  }
})();
