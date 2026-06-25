// ==UserScript==
// @name         POE2 공개 창고 화폐 자산 계산기
// @namespace    https://poe2.kr/
// @version      0.5.0
// @description  정확한 탭 표식 가격으로 공개 창고의 화폐성 자산을 로컬에서 계산합니다.
// @match        https://www.pathofexile.com/trade2/*
// @match        https://www.pathofexile.com/ko/trade2/*
// @match        https://poe.game.daum.net/trade2/*
// @match        https://poe.kakaogames.com/trade2/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      www.pathofexile.com
// @connect      poe.kakaogames.com
// @connect      poe.ninja
// @run-at       document-idle
// @updateURL    https://filterblade-kr-localizer.netlify.app/poe2-currency-wealth.user.js
// @downloadURL  https://filterblade-kr-localizer.netlify.app/poe2-currency-wealth.user.js
// ==/UserScript==
(function (root) {
  "use strict";

  const ALLOWED_GROUPS = new Set([
    "Currency",
    "Fragments",
    "Verisium",
    "Runes",
    "SoulCores",
    "Idols",
    "Expedition",
    "Vaal",
    "Delirium",
    "Breach",
    "Ritual",
    "Abyss",
    "Essences"
  ]);

  const GROUP_LABELS = {
    Currency: "화폐",
    Fragments: "조각·파편",
    Verisium: "베리시움",
    Runes: "룬·소켓 재료",
    SoulCores: "영혼 핵",
    Idols: "우상",
    Expedition: "탐험 재료",
    Vaal: "바알 재료",
    Delirium: "환영 재료",
    Breach: "균열 재료",
    Ritual: "의식·징조",
    Abyss: "심연 재료",
    Essences: "에센스"
  };

  const EXCLUDED_NAME_PATTERNS = [
    /\bWaystone\b/i,
    /\bUnique\b/i,
    /\bLogbook\b/i,
    /\bSaga\b/i,
    /\bWombgift\b/i,
    /\bInvitation\b/i,
    /\bBreachlord Sac\b/i,
    /\bCrest of the\b/i
  ];

  const DISPLAY_CURRENCIES = [
    { id: "exalted", label: "엑잘티드 오브", short: "엑잘" },
    { id: "chaos", label: "카오스 오브", short: "카오스" },
    { id: "annul", label: "소멸의 오브", short: "소멸" },
    { id: "divine", label: "디바인 오브", short: "딥" }
  ];

  const MARKER_CURRENCIES = [
    { id: "mirror", label: "칼란드라의 거울" },
    { id: "divine", label: "디바인 오브" },
    { id: "exalted", label: "엑잘티드 오브" },
    { id: "chaos", label: "카오스 오브" },
    { id: "annul", label: "소멸의 오브" }
  ];

  const ASSET_SEARCH_PARTITIONS = [
    { category: "currency", stackMin: 1, stackMax: 1 },
    { category: "currency", stackMin: 2, stackMax: 5 },
    { category: "currency", stackMin: 6, stackMax: 20 },
    { category: "currency", stackMin: 21, stackMax: 100 },
    { category: "currency", stackMin: 101, stackMax: 1000000 },
    { category: "map.fragment" },
    { category: "map.breachstone" },
    { category: "map.bosskey" },
    { category: "map.ultimatum" }
  ];

  const POE_NINJA_PRICE_TYPES = [
    "Currency",
    "Fragments",
    "Abyss",
    "Essences",
    "SoulCores",
    "Idols",
    "Runes",
    "Ritual",
    "Expedition",
    "Delirium",
    "Breach",
    "Verisium"
  ];

  const STORAGE_GROUP_LABELS = {
    Currency: "화폐",
    Fragments: "조각·파편",
    Breach: "균열",
    Delirium: "환영",
    Expedition: "탐험",
    Essences: "에센스",
    Ritual: "의식·징조",
    Abyss: "심연",
    Runes: "룬",
    SoulCores: "영혼 핵",
    Idols: "우상",
    Verisium: "베리시움"
  };

  function normalizeName(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("en-US");
  }

  function normalizeTradeAccountName(value) {
    const accountName = String(value || "").trim();
    if (accountName.includes("#")) return accountName;
    return accountName.replace(/-(\d{4})$/, "#$1");
  }

  function buildSearchPayload(
    accountName,
    markerPrice,
    markerCurrency,
    partition = null
  ) {
    const filters = {
      trade_filters: {
        filters: {
          account: { input: accountName },
          price: {
            min: markerPrice,
            max: markerPrice,
            option: markerCurrency
          }
        }
      }
    };

    if (partition?.category) {
      filters.type_filters = {
        filters: {
          category: { option: partition.category }
        }
      };
    }
    if (
      Number.isFinite(partition?.stackMin) ||
      Number.isFinite(partition?.stackMax)
    ) {
      filters.misc_filters = {
        filters: {
          stack_size: {
            ...(Number.isFinite(partition.stackMin)
              ? { min: partition.stackMin }
              : {}),
            ...(Number.isFinite(partition.stackMax)
              ? { max: partition.stackMax }
              : {})
          }
        }
      };
    }

    return {
      query: {
        status: { option: "any" },
        filters
      },
      sort: { indexed: "desc" }
    };
  }

  function extractMarkerCurrencies(groups) {
    const seen = new Set();
    const currencies = [];
    for (const group of groups || []) {
      for (const entry of group.entries || []) {
        if (!entry.id || entry.id === "sep" || !entry.text || seen.has(entry.id)) {
          continue;
        }
        seen.add(entry.id);
        currencies.push({
          id: entry.id,
          label: entry.text,
          group: group.label || group.id
        });
      }
    }
    return currencies;
  }

  function createAllowedItemMap(groups, localizedGroups = []) {
    const itemMap = new Map();
    const localizedEntries = new Map();

    for (const group of localizedGroups || []) {
      for (const entry of group.entries || []) {
        if (entry.id && entry.text) localizedEntries.set(entry.id, entry.text);
      }
    }

    for (const group of groups) {
      if (!ALLOWED_GROUPS.has(group.id)) continue;
      for (const entry of group.entries || []) {
        if (!entry.id || entry.id === "sep" || !entry.text) continue;
        if (EXCLUDED_NAME_PATTERNS.some((pattern) => pattern.test(entry.text))) continue;
        itemMap.set(normalizeName(entry.text), {
          tradeId: entry.id,
          name: localizedEntries.get(entry.id) || entry.text,
          image: entry.image
            ? new URL(entry.image, "https://www.pathofexile.com").href
            : "",
          group: group.id,
          category: GROUP_LABELS[group.id] || group.label || group.id
        });
      }
    }

    return itemMap;
  }

  function localizeResultNames(result, localizedGroups = []) {
    if (!result) return result;
    const localizedEntries = new Map();
    for (const group of localizedGroups || []) {
      for (const entry of group.entries || []) {
        if (entry.id && entry.text) localizedEntries.set(entry.id, entry.text);
      }
    }
    const localizeItems = (items) =>
      (items || []).map((item) => ({
        ...item,
        name: localizedEntries.get(item.tradeId) || item.name,
        storageGroup:
          item.storageGroup || storageGroupForItem(item, result.priceGroups)
      }));
    const visibleItems = localizeItems(result.visibleItems);
    const unpricedItems = localizeItems(result.unpricedItems);
    return {
      ...result,
      visibleItems,
      unpricedItems,
      storageGroups: summarize(visibleItems, "storageGroup")
    };
  }

  function localizeTabName(tabName) {
    const value = String(tabName || "알 수 없는 탭");
    const match = value.match(/^~(?:price|b\/o)\s+([0-9.]+)\s+(\S+)$/i);
    if (!match) return value;
    const currency =
      MARKER_CURRENCIES.find((entry) => entry.id === match[2].toLowerCase())
        ?.label || match[2];
    return `${match[1]} ${currency} 일괄 가격 탭`;
  }

  function valuesFromExalted(exaltedValue, rates) {
    return Object.fromEntries(
      DISPLAY_CURRENCIES.map((currency) => [
        currency.id,
        rates?.[currency.id] > 0 ? exaltedValue / rates[currency.id] : null
      ])
    );
  }

  function collectAllowedHoldings(fetchedItems, allowedItems, markerPrice, markerCurrency) {
    const holdings = new Map();

    for (const result of fetchedItems) {
      const listingPrice = result.listing?.price;
      if (
        !listingPrice ||
        Number(listingPrice.amount) !== Number(markerPrice) ||
        listingPrice.currency !== markerCurrency
      ) {
        continue;
      }

      const item = result.item || {};
      if (item.frameType === 3 || item.rarity === "Unique") continue;

      const candidates = [item.baseType, item.typeLine, item.name].filter(Boolean);
      const allowed = candidates
        .map((candidate) => allowedItems.get(normalizeName(candidate)))
        .find(Boolean);
      if (!allowed) continue;

      const tabName = result.listing?.stash?.name || "알 수 없는 탭";
      const quantity = Math.max(1, Number(item.stackSize) || 1);
      const key = `${allowed.tradeId}\u0000${tabName}`;
      const current = holdings.get(key);

      if (current) {
        current.quantity += quantity;
        current.stackCount += 1;
      } else {
        holdings.set(key, {
          ...allowed,
          tabName,
          quantity,
          stackCount: 1
        });
      }
    }

    return [...holdings.values()];
  }

  function parsePoeNinjaPrices(overviews) {
    const prices = { exalted: 1 };
    const priceGroups = {};
    let exaltedPerDivine = null;
    const lineMaps = [];

    for (const overview of overviews || []) {
      const overviewRate = Number(overview?.core?.rates?.exalted);
      if (overviewRate > 0 && !exaltedPerDivine) {
        exaltedPerDivine = overviewRate;
      }
      const priceType = overview?.priceType;
      lineMaps.push(new Map((overview?.lines || []).map((line) => [line.id, line])));
      for (const line of overview?.lines || []) {
        if (line.id && priceType && STORAGE_GROUP_LABELS[priceType]) {
          priceGroups[line.id] = STORAGE_GROUP_LABELS[priceType];
        }
      }
    }

    if (!(exaltedPerDivine > 0)) {
      throw new Error("poe.ninja 응답에서 Divine/Exalted 환율을 찾지 못했습니다.");
    }

    for (const lines of lineMaps) {
      for (const [id, line] of lines) {
        const divineValue = Number(line?.primaryValue);
        if (id && Number.isFinite(divineValue) && divineValue > 0) {
          prices[id] = divineValue * exaltedPerDivine;
        }
      }
    }

    prices.exalted = 1;
    prices.divine = exaltedPerDivine;
    return {
      prices,
      priceGroups,
      rates: {
        exalted: 1,
        chaos: prices.chaos || null,
        divine: exaltedPerDivine,
        annul: prices.annul || null
      }
    };
  }

  function hasUsablePriceCache(cache) {
    return Boolean(
      cache?.prices &&
        cache?.rates &&
        cache.rates.exalted > 0 &&
        cache.rates.chaos > 0 &&
        cache.rates.divine > 0 &&
        cache.rates.annul > 0
    );
  }

  function isPriceCacheFresh(cache, now = Date.now(), ttl = 30 * 60 * 1000) {
    if (!hasUsablePriceCache(cache) || !cache.updatedAt) return false;
    const updatedAt = new Date(cache.updatedAt).getTime();
    return Number.isFinite(updatedAt) && now - updatedAt < ttl;
  }

  function minimumToExalted(value, currency, rates) {
    const exPerUnit = rates[currency];
    return Number.isFinite(exPerUnit) ? value * exPerUnit : 0;
  }

  function buildResult(holdings, prices, rates, minimumValue, minimumCurrency, metadata = {}) {
    const minimumExalted = minimumToExalted(minimumValue, minimumCurrency, rates);
    const valuedItems = holdings.map((holding) => {
      const unitExalted = prices[holding.tradeId];
      return {
        ...holding,
        storageGroup: storageGroupForItem(holding, metadata.priceGroups),
        unitExalted,
        totalExalted:
          Number.isFinite(unitExalted) && unitExalted > 0
            ? unitExalted * holding.quantity
            : null
      };
    });

    const visibleItems = valuedItems
      .filter(
        (item) =>
          item.totalExalted !== null && item.totalExalted >= minimumExalted
      )
      .sort((left, right) => right.totalExalted - left.totalExalted);
    const unpricedItems = valuedItems
      .filter((item) => item.totalExalted === null)
      .sort((left, right) => left.name.localeCompare(right.name));
    const totalExalted = visibleItems.reduce(
      (sum, item) => sum + item.totalExalted,
      0
    );

    return {
      syncedAt: new Date().toISOString(),
      priceUpdatedAt: metadata.priceUpdatedAt || null,
      usedStalePrices: Boolean(metadata.usedStalePrices),
      warnings: metadata.warnings || [],
      priceGroups: metadata.priceGroups || {},
      rates,
      minimumValue,
      minimumCurrency,
      minimumExalted,
      totalExalted,
      totals: Object.fromEntries(
        DISPLAY_CURRENCIES.map((currency) => [
          currency.id,
          rates[currency.id] ? totalExalted / rates[currency.id] : null
        ])
      ),
      totalStackCount: visibleItems.reduce(
        (sum, item) => sum + item.stackCount,
        0
      ),
      visibleItems,
      unpricedItems,
      categories: summarize(visibleItems, "category"),
      tabs: summarize(visibleItems, "tabName"),
      storageGroups: summarize(visibleItems, "storageGroup")
    };
  }

  function storageGroupForItem(item, priceGroups = {}) {
    if (priceGroups?.[item.tradeId]) return priceGroups[item.tradeId];
    const fallback = {
      Currency: "화폐",
      Fragments: "조각·파편",
      Vaal: "조각·파편",
      Breach: "균열",
      Delirium: "환영",
      Expedition: "탐험",
      Essences: "에센스",
      Ritual: "의식·징조",
      Abyss: "심연",
      Runes: "룬",
      SoulCores: "영혼 핵",
      Idols: "우상",
      Verisium: "베리시움"
    };
    return fallback[item.group] || item.category || "기타";
  }

  function summarize(items, key) {
    const values = new Map();
    for (const item of items) {
      values.set(item[key], (values.get(item[key]) || 0) + item.totalExalted);
    }
    return [...values.entries()]
      .map(([name, totalExalted]) => ({ name, totalExalted }))
      .sort((left, right) => right.totalExalted - left.totalExalted);
  }

  function parseRateLimitHeaders(headers) {
    const get = (name) =>
      typeof headers?.get === "function"
        ? headers.get(name)
        : headers?.[name] || headers?.[name.toLowerCase()] || null;
    const rules = String(get("X-Rate-Limit-Rules") || "")
      .split(",")
      .map((rule) => rule.trim())
      .filter(Boolean);
    const result = [];

    for (const rule of rules) {
      const limits = String(get(`X-Rate-Limit-${rule}`) || "").split(",");
      const states = String(get(`X-Rate-Limit-${rule}-State`) || "").split(",");
      limits.forEach((limit, index) => {
        const [maximum, period, penalty] = limit.split(":").map(Number);
        const [current, statePeriod, active] = (states[index] || "")
          .split(":")
          .map(Number);
        if (Number.isFinite(maximum) && Number.isFinite(period)) {
          result.push({
            rule,
            maximum,
            period,
            penalty: penalty || 0,
            current: current || 0,
            statePeriod: statePeriod || period,
            active: active || 0
          });
        }
      });
    }
    return result;
  }

  function rateLimitWaitMs(headers) {
    const retryAfter = Number(
      typeof headers?.get === "function"
        ? headers.get("Retry-After")
        : headers?.["Retry-After"] || headers?.["retry-after"]
    );
    if (retryAfter > 0) return (retryAfter + 1) * 1000;

    const states = parseRateLimitHeaders(headers);
    const active = Math.max(0, ...states.map((state) => state.active));
    if (active > 0) return (active + 1) * 1000;

    const nearLimit = states
      .filter((state) => state.current >= state.maximum - 1)
      .map((state) => state.period);
    return nearLimit.length ? (Math.min(...nearLimit) + 1) * 1000 : 0;
  }

  function findAccountName(documentLike) {
    const links = [...(documentLike?.querySelectorAll?.("a[href]") || [])];
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/account\/view-profile\/([^/?#]+)/i);
      if (match) {
        return normalizeTradeAccountName(decodeURIComponent(match[1]));
      }
    }
    return "";
  }

  root.Poe2WealthCore = {
    DISPLAY_CURRENCIES,
    MARKER_CURRENCIES,
    ASSET_SEARCH_PARTITIONS,
    POE_NINJA_PRICE_TYPES,
    STORAGE_GROUP_LABELS,
    normalizeName,
    normalizeTradeAccountName,
    buildSearchPayload,
    extractMarkerCurrencies,
    createAllowedItemMap,
    localizeResultNames,
    localizeTabName,
    collectAllowedHoldings,
    parsePoeNinjaPrices,
    hasUsablePriceCache,
    isPriceCacheFresh,
    minimumToExalted,
    valuesFromExalted,
    storageGroupForItem,
    buildResult,
    parseRateLimitHeaders,
    rateLimitWaitMs,
    findAccountName
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

(function () {
  "use strict";

  const core = globalThis.Poe2WealthCore;
  const IS_KAKAO_TRADE = [
    "poe.game.daum.net",
    "poe.kakaogames.com"
  ].includes(location.hostname);
  const API_ROOT = IS_KAKAO_TRADE
    ? "https://poe.kakaogames.com/api/trade2"
    : "https://www.pathofexile.com/api/trade2";
  const KOREAN_STATIC_URL =
    "https://poe.kakaogames.com/api/trade2/data/static?realm=poe2";
  const POE_NINJA_ROOT = "https://poe.ninja/poe2/api/economy/exchange/current/overview";
  const STATE_KEY = "poe2CurrencyWealthUserscriptStateV6";
  const LEGACY_STATE_KEY = "poe2CurrencyWealthUserscriptStateV5";
  const CACHE_KEY = "poe2CurrencyWealthUserscriptPoeNinjaCacheV2";
  const PRICE_CACHE_TTL = 30 * 60 * 1000;
  let nextRequestAt = 0;
  let staticGroups = [];
  let localizedStaticGroups = [];
  let renderedResult = null;

  const style = document.createElement("style");
  style.textContent = `
    #poe2-wealth-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483646;border:1px solid #d19a50;border-radius:999px;background:#16130f;color:#efbd77;padding:11px 17px;font:700 13px system-ui;cursor:pointer;box-shadow:0 8px 28px #0008}
    #poe2-wealth-overlay{position:fixed;inset:0;z-index:2147483647;background:#06080bd9;display:none;overflow:auto;color:#eef0f3;font:14px system-ui}
    #poe2-wealth-overlay.open{display:block}
    #poe2-wealth-overlay,#poe2-wealth-overlay *{box-sizing:border-box}
    .pw-shell{width:min(1120px,calc(100% - 40px));margin:28px auto 80px}
    .pw-head,.pw-form,.pw-summary,.pw-row{display:flex;align-items:center;gap:12px}
    .pw-head{justify-content:space-between}.pw-head h1{margin:0;font:400 32px Georgia;color:#f2f2f2}.pw-head button{font-size:22px}
    .pw-panel{margin-top:16px;border:1px solid #30343c;border-radius:12px;background:#12151a;padding:18px}
    .pw-form{flex-wrap:wrap;align-items:end}.pw-form label{display:grid;gap:6px;min-width:150px;flex:1;color:#aab0ba;font-size:12px}.pw-form label.pw-value-field{min-width:270px}
    .pw-form input,.pw-form select{height:38px;border:1px solid #383e48;border-radius:7px;background:#0b0e12;color:#fff;padding:0 10px}
    .pw-inline{display:flex;gap:7px;min-width:0}.pw-inline input{flex:1;min-width:0}.pw-value-field .pw-inline input{flex:0 0 96px;width:96px;min-width:96px}.pw-value-field .pw-inline select{flex:1;width:auto;min-width:145px}
    .pw-button{height:40px;border:0;border-radius:7px;background:#c38a43;color:#171006;padding:0 16px;font-weight:800;cursor:pointer}
    .pw-button.secondary{background:#252a32;color:#ddd}.pw-summary{display:grid;grid-template-columns:1.4fr repeat(3,1fr)}
    .pw-card{border:1px solid #2d323b;border-radius:10px;background:#0d1015;padding:16px}.pw-card span{color:#9198a4;font-size:12px}.pw-card strong{display:block;margin-top:8px;font-size:23px;color:#e4b46e}
    .pw-status{margin-top:12px;color:#cdb58f;white-space:pre-wrap}.pw-error{color:#fca5a5}.pw-warning{color:#f5d08a}
    .pw-table{width:100%;border-collapse:collapse;margin-top:12px}.pw-table th,.pw-table td{padding:12px 10px;border-bottom:1px solid #292e36;text-align:left;vertical-align:middle}.pw-table th{color:#8f96a2;font-size:11px}.pw-table .num{text-align:right}.pw-item-name{display:flex;align-items:center;gap:10px;font-weight:700}.pw-item-name img{width:34px;height:34px;object-fit:contain;flex:0 0 34px}.pw-value{font-size:14px;font-weight:700;color:#e4b46e;white-space:nowrap}
    .pw-groups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.pw-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid #292e36;border-radius:8px;background:#0d1015}
    .pw-group-row{cursor:pointer}.pw-group-row:hover{border-color:#9b6a32;color:#efbd77}.pw-note{margin:6px 0 0;color:#8f96a2;font-size:12px}.pw-table-controls{display:flex;align-items:center;justify-content:space-between;gap:12px}.pw-table-controls select{width:min(320px,100%);height:38px;border:1px solid #383e48;border-radius:7px;background:#0b0e12;color:#fff;padding:0 10px}
    .pw-check{display:flex!important;grid-auto-flow:column;align-items:center;justify-content:start}.pw-check input{width:16px;height:16px}
    @media(max-width:850px){.pw-summary{grid-template-columns:1fr 1fr}.pw-groups{grid-template-columns:1fr 1fr}}
  `;
  document.documentElement.append(style);

  const launcher = document.createElement("button");
  launcher.id = "poe2-wealth-launcher";
  launcher.textContent = "화폐 자산 계산";
  document.body.append(launcher);

  const overlay = document.createElement("div");
  overlay.id = "poe2-wealth-overlay";
  overlay.innerHTML = `
    <main class="pw-shell">
      <header class="pw-head"><h1>POE2 공개 창고 화폐 자산 계산기</h1><button class="pw-button secondary" data-close>×</button></header>
      <section class="pw-panel pw-form">
        <label>계정명<div class="pw-inline"><input data-account placeholder="Account#1234"><button class="pw-button secondary" data-detect>감지</button></div></label>
        <label>리그<select data-league></select></label>
        <label class="pw-value-field">탭 표식 가격<div class="pw-inline"><input data-marker-price type="number" min="0.0001" step="any" value="1"><select data-marker-currency></select></div></label>
        <label class="pw-value-field">최소 표시 가치<div class="pw-inline"><input data-minimum type="number" min="0" step="0.1" value="0"><select data-minimum-currency></select></div></label>
        <label>가치 표시 단위<select data-display-currency></select></label>
        <label class="pw-check"><input data-refresh type="checkbox">시세 강제 갱신</label>
        <button class="pw-button" data-sync>창고 동기화</button>
      </section>
      <div class="pw-status" data-status>모든 요청과 저장은 이 브라우저에서만 처리됩니다.</div>
      <section data-results hidden>
        <div class="pw-panel pw-summary">
          <article class="pw-card"><span>추적 가능한 총자산</span><strong data-total-value>-</strong></article>
          <article class="pw-card"><span>계산된 품목</span><strong data-priced-count>-</strong></article>
          <article class="pw-card"><span>가격 미확인</span><strong data-unpriced-count>-</strong></article>
          <article class="pw-card"><span>시세 갱신</span><strong data-price-updated>-</strong></article>
        </div>
        <section class="pw-panel"><h2>보관함 종류별 자산</h2><p class="pw-note">실제 탭 이름이 아니라 아이템 종류를 기준으로 자동 분류합니다.</p><div class="pw-groups" data-storage-groups></div></section>
        <section class="pw-panel">
          <div class="pw-table-controls"><h2>가치가 높은 화폐성 아이템</h2><select data-group-filter aria-label="보관함 종류 선택"><option value="">모든 보관함 종류</option></select></div>
          <table class="pw-table"><thead><tr><th>아이템</th><th>보관함 종류</th><th class="num">수량</th><th class="num">개당 가치</th><th class="num">총가치</th></tr></thead><tbody data-items></tbody></table>
        </section>
      </section>
    </main>
  `;
  document.body.append(overlay);

  const $ = (selector) => overlay.querySelector(selector);
  const ui = {
    account: $("[data-account]"),
    league: $("[data-league]"),
    markerPrice: $("[data-marker-price]"),
    markerCurrency: $("[data-marker-currency]"),
    minimum: $("[data-minimum]"),
    minimumCurrency: $("[data-minimum-currency]"),
    displayCurrency: $("[data-display-currency]"),
    refresh: $("[data-refresh]"),
    sync: $("[data-sync]"),
    status: $("[data-status]"),
    results: $("[data-results]"),
    totalValue: $("[data-total-value]"),
    pricedCount: $("[data-priced-count]"),
    unpricedCount: $("[data-unpriced-count]"),
    priceUpdated: $("[data-price-updated]"),
    storageGroups: $("[data-storage-groups]"),
    items: $("[data-items]"),
    groupFilter: $("[data-group-filter]")
  };

  launcher.addEventListener("click", () => overlay.classList.add("open"));
  $("[data-close]").addEventListener("click", () => overlay.classList.remove("open"));
  $("[data-detect]").addEventListener("click", detectAccount);
  ui.sync.addEventListener("click", () => synchronize().catch(showError));
  ui.groupFilter.addEventListener("change", () => renderItems());
  ui.displayCurrency.addEventListener("change", () => {
    render(renderedResult);
    persistDisplayCurrency().catch(showError);
  });

  initialize().catch(showError);

  async function initialize() {
    ui.minimumCurrency.replaceChildren(
      ...core.DISPLAY_CURRENCIES.map((currency) => option(currency.id, currency.label))
    );
    ui.displayCurrency.replaceChildren(
      ...core.DISPLAY_CURRENCIES.map((currency) => option(currency.id, currency.label))
    );
    const leagues = await apiRequest(`${API_ROOT}/data/leagues`);
    const staticData = await apiRequest(`${API_ROOT}/data/static?realm=poe2`);
    const localizedStaticResponse = await gmRequest(KOREAN_STATIC_URL, {}).catch(
      () => null
    );
    staticGroups = staticData.result || [];
    localizedStaticGroups = localizedStaticResponse?.data?.result || [];
    ui.markerCurrency.replaceChildren(
      ...core.MARKER_CURRENCIES.map((currency) => option(currency.id, currency.label))
    );
    ui.league.replaceChildren(
      ...(leagues.result || [])
        .filter((league) => league.realm === "poe2")
        .map((league) => option(league.id, league.text))
    );

    const state =
      (await GM_getValue(STATE_KEY, null)) ||
      (await GM_getValue(LEGACY_STATE_KEY, null));
    if (state) {
      ui.account.value = core.normalizeTradeAccountName(state.accountName);
      ui.league.value = state.league || ui.league.value;
      ui.markerPrice.value = String(state.markerPrice ?? 1);
      ui.markerCurrency.value = state.markerCurrency || "mirror";
      ui.minimum.value = String(state.minimumValue ?? 0);
      ui.minimumCurrency.value = state.minimumCurrency || "exalted";
      ui.displayCurrency.value = state.displayCurrency || "exalted";
      if (state.result) {
        render(core.localizeResultNames(state.result, localizedStaticGroups));
      }
    }
    if (!ui.account.value) detectAccount();
  }

  function detectAccount() {
    const accountName = core.findAccountName(document);
    if (accountName) {
      ui.account.value = accountName;
      setStatus(`계정명 감지 완료: ${accountName}`);
    } else {
      setStatus("계정명을 감지하지 못했습니다. 수동으로 입력하세요.", "warning");
    }
  }

  async function synchronize() {
    const settings = {
      accountName: core.normalizeTradeAccountName(ui.account.value),
      league: ui.league.value,
      markerPrice: Number(ui.markerPrice.value),
      markerCurrency: ui.markerCurrency.value,
      minimumValue: Math.max(0, Number(ui.minimum.value) || 0),
      minimumCurrency: ui.minimumCurrency.value,
      displayCurrency: ui.displayCurrency.value,
      forcePriceRefresh: ui.refresh.checked
    };
    ui.account.value = settings.accountName;
    if (!settings.accountName) throw new Error("계정명을 입력하세요.");
    if (!(settings.markerPrice > 0)) throw new Error("탭 표식 가격을 확인하세요.");

    ui.sync.disabled = true;
    setStatus("정확한 표식 가격으로 공개 창고를 검색하는 중입니다.");
    try {
      const allowedItems = core.createAllowedItemMap(
        staticGroups,
        localizedStaticGroups
      );
      const searchResults = await searchAssetPartitions(settings);
      const ids = searchResults.ids;
      if (!ids.length) throw new Error("표식 가격과 정확히 일치하는 항목이 없습니다.");

      const warnings = [...searchResults.warnings];
      const details = [];
      for (let offset = 0; offset < ids.length; offset += 10) {
        setStatus(`아이템 상세 정보 ${Math.min(offset + 10, ids.length)} / ${ids.length}`);
        const response = await apiRequest(
          `${API_ROOT}/fetch/${ids.slice(offset, offset + 10).join(",")}?realm=poe2`
        );
        details.push(...(response.result || []));
      }

      const holdings = core.collectAllowedHoldings(
        details,
        allowedItems,
        settings.markerPrice,
        settings.markerCurrency
      );
      if (!holdings.length) throw new Error("계산 대상 화폐성 아이템이 없습니다.");

      const priceResult = await loadPoeNinjaPrices(
        settings.league,
        settings.forcePriceRefresh
      );
      if (priceResult.usedStalePrices) {
        warnings.push("poe.ninja 조회 실패로 저장된 이전 시세를 사용했습니다.");
      }
      const result = core.buildResult(
        holdings,
        priceResult.prices,
        priceResult.rates,
        settings.minimumValue,
        settings.minimumCurrency,
        {
          priceUpdatedAt: priceResult.updatedAt,
          usedStalePrices: priceResult.usedStalePrices,
          priceGroups: priceResult.priceGroups,
          warnings
        }
      );
      await GM_setValue(STATE_KEY, { ...settings, forcePriceRefresh: false, result });
      ui.refresh.checked = false;
      render(result);
      setStatus(
        warnings.length ? `완료\n${warnings.join("\n")}` : "동기화 완료",
        warnings.length ? "warning" : ""
      );
    } finally {
      ui.sync.disabled = false;
    }
  }

  async function searchAssetPartitions(settings) {
    const ids = new Set();
    const warnings = [];
    for (let index = 0; index < core.ASSET_SEARCH_PARTITIONS.length; index += 1) {
      const partition = core.ASSET_SEARCH_PARTITIONS[index];
      setStatus(
        `화폐성 아이템 분할 검색 ${index + 1} / ${core.ASSET_SEARCH_PARTITIONS.length}`
      );
      const search = await apiRequest(
        `${API_ROOT}/search/poe2/${encodeURIComponent(settings.league)}`,
        {
          method: "POST",
          body: JSON.stringify(
            core.buildSearchPayload(
              settings.accountName,
              settings.markerPrice,
              settings.markerCurrency,
              partition
            )
          )
        }
      );
      const partitionIds = search.result || [];
      partitionIds.forEach((id) => ids.add(id));
      if (Number(search.total) > partitionIds.length) {
        warnings.push(
          `${partition.category} ${search.total}개 중 ${partitionIds.length}개만 수집`
        );
      }
    }
    return { ids: [...ids], warnings };
  }

  async function loadPoeNinjaPrices(league, forceRefresh) {
    const allCaches = await GM_getValue(CACHE_KEY, {});
    const cached = allCaches[league] || null;
    if (!forceRefresh && core.isPriceCacheFresh(cached, Date.now(), PRICE_CACHE_TTL)) {
      return { ...cached, usedStalePrices: false };
    }

    try {
      const overviews = [];
      for (let index = 0; index < core.POE_NINJA_PRICE_TYPES.length; index += 1) {
        const type = core.POE_NINJA_PRICE_TYPES[index];
        setStatus(`poe.ninja 시세 ${type} · ${index + 1} / ${core.POE_NINJA_PRICE_TYPES.length}`);
        overviews.push({
          ...(await ninjaRequest(
            `${POE_NINJA_ROOT}?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`
          )),
          priceType: type
        });
      }

      const parsed = core.parsePoeNinjaPrices(overviews);
      if (!parsed.rates.chaos || !parsed.rates.divine || !parsed.rates.annul) {
        throw new Error("poe.ninja에서 카오스·딥·소멸 환율을 찾지 못했습니다.");
      }
      const fresh = {
        prices: parsed.prices,
        priceGroups: parsed.priceGroups,
        rates: parsed.rates,
        updatedAt: new Date().toISOString()
      };
      allCaches[league] = fresh;
      await GM_setValue(CACHE_KEY, allCaches);
      return { ...fresh, usedStalePrices: false };
    } catch (error) {
      if (core.hasUsablePriceCache(cached)) {
        return { ...cached, usedStalePrices: true };
      }
      throw error;
    }
  }

  async function ninjaRequest(url) {
    const response = await gmRequest(url, {});
    if (response.status < 200 || response.status >= 300 || !response.data) {
      throw new Error(`poe.ninja 시세 조회 실패 (${response.status})`);
    }
    return response.data;
  }

  async function apiRequest(url, options = {}, attempt = 0) {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) {
      setStatus(`요청 제한 준수를 위해 ${Math.ceil(wait / 1000)}초 대기 중`);
      await delay(wait);
    }
    const response = await gmRequest(url, options);
    const waitMs = core.rateLimitWaitMs(response.headers);
    if (waitMs) nextRequestAt = Math.max(nextRequestAt, Date.now() + waitMs);
    if (response.status === 429 && attempt < 2) {
      const retry = Math.max(waitMs, 15000);
      await delay(retry);
      return apiRequest(url, options, attempt + 1);
    }
    if (response.status === 401) throw new Error("Path of Exile 로그인이 필요합니다.");
    if (response.status === 403) throw new Error("거래 사이트가 요청을 차단했습니다.");
    if (response.status === 429) throw new Error("거래 API 요청 제한에 도달했습니다.");
    if (response.status < 200 || response.status >= 300 || response.data?.error) {
      throw new Error(response.data?.error?.message || `거래 API 오류 (${response.status})`);
    }
    return response.data;
  }

  function gmRequest(url, options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url,
        data: options.body,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {})
        },
        anonymous: false,
        onload: (response) => {
          let data = null;
          try {
            data = JSON.parse(response.responseText);
          } catch {
            // Handled by status validation.
          }
          resolve({
            status: response.status,
            data,
            headers: parseHeaders(response.responseHeaders)
          });
        },
        onerror: () => reject(new Error("네트워크 요청에 실패했습니다."))
      });
    });
  }

  function parseHeaders(raw) {
    const map = new Map();
    String(raw || "")
      .split(/\r?\n/)
      .forEach((line) => {
        const index = line.indexOf(":");
        if (index > 0) {
          map.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
        }
      });
    return { get: (name) => map.get(name.toLowerCase()) || null };
  }

  function render(result) {
    if (!result) return;
    renderedResult = result;
    ui.results.hidden = false;
    const currency = selectedDisplayCurrency();
    ui.totalValue.textContent = formatExaltedValue(
      result.totalExalted,
      result.rates,
      currency
    );
    ui.pricedCount.textContent = result.visibleItems.length.toLocaleString();
    ui.unpricedCount.textContent = result.unpricedItems.length.toLocaleString();
    ui.priceUpdated.textContent = result.priceUpdatedAt
      ? new Intl.DateTimeFormat("ko-KR", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        }).format(new Date(result.priceUpdatedAt))
      : "-";
    renderStorageGroups(result.storageGroups || []);
    populateGroupFilter(result.visibleItems);
    renderItems();
  }

  function populateGroupFilter(items) {
    const current = ui.groupFilter.value;
    const groups = [...new Set(items.map((item) => item.storageGroup))].sort(
      (a, b) => a.localeCompare(b, "ko")
    );
    ui.groupFilter.replaceChildren(
      option("", "모든 보관함 종류"),
      ...groups.map((group) => option(group, group))
    );
    ui.groupFilter.value = groups.includes(current) ? current : "";
  }

  function renderItems() {
    if (!renderedResult) return;
    const selectedGroup = ui.groupFilter.value;
    const currency = selectedDisplayCurrency();
    ui.items.replaceChildren(
      ...renderedResult.visibleItems
        .filter((item) => !selectedGroup || item.storageGroup === selectedGroup)
        .map((item) => {
        const row = document.createElement("tr");
        row.innerHTML = `<td></td><td></td><td class="num"></td><td class="num"></td><td class="num"></td>`;
        const itemCell = row.children[0];
        itemCell.className = "pw-item-name";
        if (item.image) {
          const image = document.createElement("img");
          image.src = item.image;
          image.alt = "";
          image.loading = "lazy";
          itemCell.append(image);
        }
        itemCell.append(document.createTextNode(item.name));
        row.children[1].textContent = item.storageGroup;
        row.children[2].textContent = item.quantity.toLocaleString();
        row.children[3].classList.add("pw-value");
        row.children[4].classList.add("pw-value");
        row.children[3].textContent = formatExaltedValue(
          item.unitExalted,
          renderedResult.rates,
          currency
        );
        row.children[4].textContent = formatExaltedValue(
          item.totalExalted,
          renderedResult.rates,
          currency
        );
        return row;
      })
    );
  }

  function renderStorageGroups(rows) {
    const currency = selectedDisplayCurrency();
    ui.storageGroups.replaceChildren(
      ...rows.map((entry) => {
        const row = document.createElement("div");
        row.className = "pw-row pw-group-row";
        const name = document.createElement("span");
        name.textContent = entry.name;
        const value = document.createElement("strong");
        value.className = "pw-value";
        value.textContent = formatExaltedValue(
          entry.totalExalted,
          renderedResult.rates,
          currency
        );
        row.append(name, value);
        row.title = "이 보관함 종류의 아이템만 보기";
        row.addEventListener("click", () => {
          ui.groupFilter.value = entry.name;
          renderItems();
        });
        return row;
      })
    );
  }

  function selectedDisplayCurrency() {
    return (
      core.DISPLAY_CURRENCIES.find(
        (currency) => currency.id === ui.displayCurrency.value
      ) || core.DISPLAY_CURRENCIES[0]
    );
  }

  function formatExaltedValue(exaltedValue, rates, currency) {
    const values = core.valuesFromExalted(exaltedValue, rates);
    return `${format(values[currency.id])} ${currency.short}`;
  }

  async function persistDisplayCurrency() {
    const state = (await GM_getValue(STATE_KEY, null)) || {};
    await GM_setValue(STATE_KEY, {
      ...state,
      displayCurrency: ui.displayCurrency.value,
      ...(renderedResult ? { result: renderedResult } : {})
    });
  }

  function setStatus(message, type = "") {
    ui.status.className = `pw-status${type ? ` pw-${type}` : ""}`;
    ui.status.textContent = message;
  }

  function showError(error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), "error");
    ui.sync.disabled = false;
  }

  function option(value, text) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = text;
    return item;
  }

  function format(value) {
    if (!Number.isFinite(value)) return "-";
    return new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2
    }).format(value);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();

