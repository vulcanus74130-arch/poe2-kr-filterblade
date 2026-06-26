// ==UserScript==
// @name         Exile Ledger — POE2 창고 자산 추적기
// @namespace    https://poe2.kr/
// @version      0.7.3
// @description  POE2 공개 창고의 화폐성 자산 가치와 변동을 추적합니다.
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

  const POE2_LEAGUES = [
    { id: "Runes of Aldur", label: "알두르의 룬", tradeEnabled: true },
    { id: "HC Runes of Aldur", label: "알두르의 룬 하드코어", tradeEnabled: true },
    { id: "Standard", label: "스탠다드", tradeEnabled: true },
    { id: "Hardcore", label: "하드코어", tradeEnabled: true },
    {
      id: "SSF Runes of Aldur",
      label: "SSF 알두르의 룬 (거래 검색 불가)",
      tradeEnabled: false
    }
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

  function buildLeagueOptions(apiLeagues = []) {
    const known = new Set(POE2_LEAGUES.map((league) => league.id));
    const extraLeagues = (apiLeagues || [])
      .filter((league) => league?.realm === "poe2" && league.id && !known.has(league.id))
      .map((league) => ({
        id: league.id,
        label: league.text || league.id,
        tradeEnabled: true
      }));
    return [...POE2_LEAGUES, ...extraLeagues];
  }

  function isTradeEnabledLeague(leagueId) {
    const league = POE2_LEAGUES.find((entry) => entry.id === leagueId);
    return league ? league.tradeEnabled : Boolean(leagueId);
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
    const pricedItems = localizeItems(
      result.pricedItems || result.visibleItems
    );
    const visibleIds = new Set(
      (result.visibleItems || []).map(
        (item) => `${item.tradeId}\u0000${item.tabName}`
      )
    );
    const visibleItems = pricedItems.filter((item) =>
      visibleIds.has(`${item.tradeId}\u0000${item.tabName}`)
    );
    const unpricedItems = localizeItems(result.unpricedItems);
    return {
      ...result,
      pricedItems,
      visibleItems,
      unpricedItems,
      storageGroups: summarize(pricedItems, "storageGroup")
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
    const marketMeta = {};
    let exaltedPerDivine = null;
    const lineMaps = [];

    for (const overview of overviews || []) {
      const overviewRate = Number(overview?.core?.rates?.exalted);
      if (overviewRate > 0 && !exaltedPerDivine) {
        exaltedPerDivine = overviewRate;
      }
      const priceType = overview?.priceType;
      const itemMetadata = new Map(
        [...(overview?.items || []), ...(overview?.core?.items || [])].map(
          (item) => [item.id, item]
        )
      );
      const volumes = (overview?.lines || [])
        .map((line) => Number(line?.volumePrimaryValue))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((left, right) => left - right);
      const lowVolumeThreshold = percentile(volumes, 0.25);
      lineMaps.push(new Map((overview?.lines || []).map((line) => [line.id, line])));
      for (const line of overview?.lines || []) {
        if (line.id && priceType && STORAGE_GROUP_LABELS[priceType]) {
          priceGroups[line.id] = STORAGE_GROUP_LABELS[priceType];
        }
        if (line.id) {
          const item = itemMetadata.get(line.id);
          const volume = Number(line?.volumePrimaryValue);
          const change = Number(line?.sparkline?.totalChange);
          marketMeta[line.id] = {
            priceType: priceType || null,
            volume: Number.isFinite(volume) ? volume : null,
            change7d: Number.isFinite(change) ? change : null,
            lowVolume:
              Number.isFinite(volume) &&
              Number.isFinite(lowVolumeThreshold) &&
              volume <= lowVolumeThreshold,
            volatile: Number.isFinite(change) && Math.abs(change) >= 20,
            image: item?.image
              ? new URL(item.image, "https://poe.ninja").href
              : ""
          };
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
      marketMeta,
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
      const market = metadata.marketMeta?.[holding.tradeId] || {};
      return {
        ...holding,
        storageGroup: storageGroupForItem(holding, metadata.priceGroups),
        image: holding.image || market.image || "",
        market,
        priceSource: metadata.priceSources?.[holding.tradeId] || "poe.ninja",
        marketUnitExalted:
          metadata.basePrices?.[holding.tradeId] ?? unitExalted ?? null,
        unitExalted,
        totalExalted:
          Number.isFinite(unitExalted) && unitExalted > 0
            ? unitExalted * holding.quantity
            : null
      };
    });

    const pricedItems = valuedItems
      .filter((item) => item.totalExalted !== null)
      .sort((left, right) => right.totalExalted - left.totalExalted);
    const visibleItems = pricedItems
      .filter(
        (item) => item.totalExalted >= minimumExalted
      )
      .slice();
    const unpricedItems = valuedItems
      .filter((item) => item.totalExalted === null)
      .sort((left, right) => left.name.localeCompare(right.name));
    const totalExalted = pricedItems.reduce(
      (sum, item) => sum + item.totalExalted,
      0
    );

    return {
      syncedAt: new Date().toISOString(),
      priceUpdatedAt: metadata.priceUpdatedAt || null,
      usedStalePrices: Boolean(metadata.usedStalePrices),
      staleCategories: metadata.staleCategories || [],
      warnings: metadata.warnings || [],
      priceGroups: metadata.priceGroups || {},
      marketMeta: metadata.marketMeta || {},
      basePrices: metadata.basePrices || {},
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
      totalStackCount: pricedItems.reduce(
        (sum, item) => sum + item.stackCount,
        0
      ),
      pricedItems,
      visibleItems,
      unpricedItems,
      categories: summarize(pricedItems, "category"),
      tabs: summarize(pricedItems, "tabName"),
      storageGroups: summarize(pricedItems, "storageGroup"),
      lowVolumeCount: pricedItems.filter((item) => item.market?.lowVolume).length,
      volatileCount: pricedItems.filter((item) => item.market?.volatile).length
    };
  }

  function applyPriceOverrides(prices, overrides, rates) {
    const merged = { ...(prices || {}) };
    const priceSources = {};
    for (const [tradeId, override] of Object.entries(overrides || {})) {
      const value = Number(override?.value);
      const rate = Number(rates?.[override?.currency]);
      if (value > 0 && rate > 0) {
        merged[tradeId] = value * rate;
        priceSources[tradeId] = "직접 지정";
      }
    }
    return { prices: merged, priceSources };
  }

  function createSnapshot(result, context = {}) {
    const items = (result?.pricedItems || result?.visibleItems || []).map((item) => ({
      tradeId: item.tradeId,
      name: item.name,
      storageGroup: item.storageGroup,
      quantity: item.quantity,
      unitExalted: item.unitExalted,
      totalExalted: item.totalExalted
    }));
    return {
      id: context.id || new Date().toISOString(),
      createdAt: context.createdAt || new Date().toISOString(),
      accountName: context.accountName || "",
      league: context.league || "",
      totalExalted: result?.totalExalted || 0,
      storageGroups: result?.storageGroups || [],
      items
    };
  }

  function appendHistory(history, snapshot, limit = 90) {
    return [...(history || []), snapshot].slice(-Math.max(1, limit));
  }

  function compareSnapshots(previous, current) {
    if (!previous || !current) return null;
    const previousItems = new Map(
      (previous.items || []).map((item) => [item.tradeId, item])
    );
    const currentItems = new Map(
      (current.items || []).map((item) => [item.tradeId, item])
    );
    const tradeIds = new Set([...previousItems.keys(), ...currentItems.keys()]);
    let quantityChangeExalted = 0;
    let priceChangeExalted = 0;
    const newItems = [];
    const depletedItems = [];

    for (const tradeId of tradeIds) {
      const before = previousItems.get(tradeId);
      const after = currentItems.get(tradeId);
      const beforeQuantity = Number(before?.quantity) || 0;
      const afterQuantity = Number(after?.quantity) || 0;
      const beforeUnit = Number(before?.unitExalted) || 0;
      const afterUnit = Number(after?.unitExalted) || 0;
      if (!before && after) {
        quantityChangeExalted += afterQuantity * afterUnit;
        newItems.push(after);
        continue;
      }
      if (before && !after) {
        quantityChangeExalted -= beforeQuantity * beforeUnit;
        depletedItems.push(before);
        continue;
      }
      quantityChangeExalted += (afterQuantity - beforeQuantity) * beforeUnit;
      priceChangeExalted += afterQuantity * (afterUnit - beforeUnit);
    }

    return {
      totalChangeExalted:
        (Number(current.totalExalted) || 0) -
        (Number(previous.totalExalted) || 0),
      quantityChangeExalted,
      priceChangeExalted,
      newItems,
      depletedItems
    };
  }

  function toCsv(result, displayCurrency = "exalted", liquidationRate = 1) {
    const currency =
      DISPLAY_CURRENCIES.find((entry) => entry.id === displayCurrency) ||
      DISPLAY_CURRENCIES[0];
    const rate = Number(result?.rates?.[currency.id]) || 1;
    const rows = [
      [
        "아이템",
        "보관함 종류",
        "수량",
        `개당 가치(${currency.short})`,
        `총가치(${currency.short})`,
        "가격 출처",
        "거래량",
        "7일 변동률",
        "시세 상태"
      ]
    ];
    for (const item of result?.pricedItems || result?.visibleItems || []) {
      const statuses = [
        item.market?.lowVolume ? "거래량 낮음" : "",
        item.market?.volatile ? "가격 변동 큼" : ""
      ].filter(Boolean);
      rows.push([
        item.name,
        item.storageGroup,
        item.quantity,
        (item.unitExalted / rate) * liquidationRate,
        (item.totalExalted / rate) * liquidationRate,
        item.priceSource,
        item.market?.volume ?? "",
        item.market?.change7d ?? "",
        statuses.join(", ")
      ]);
    }
    return rows
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
  }

  function summaryText(result, displayCurrency = "exalted", liquidationRate = 1) {
    const currency =
      DISPLAY_CURRENCIES.find((entry) => entry.id === displayCurrency) ||
      DISPLAY_CURRENCIES[0];
    const rate = Number(result?.rates?.[currency.id]) || 1;
    const total = ((result?.totalExalted || 0) / rate) * liquidationRate;
    const groups = (result?.storageGroups || [])
      .map(
        (group) =>
          `${group.name} ${formatPlain((group.totalExalted / rate) * liquidationRate)} ${currency.short}`
      )
      .join(", ");
    return `POE2 추적 가능한 자산: ${formatPlain(total)} ${currency.short}\n보관함 종류별: ${groups}\n가격 미확인: ${(result?.unpricedItems || []).length}개`;
  }

  function percentile(sortedValues, ratio) {
    if (!sortedValues.length) return null;
    const index = Math.floor((sortedValues.length - 1) * ratio);
    return sortedValues[index];
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  }

  function formatPlain(value) {
    return new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2
    }).format(value);
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
    POE2_LEAGUES,
    ASSET_SEARCH_PARTITIONS,
    POE_NINJA_PRICE_TYPES,
    STORAGE_GROUP_LABELS,
    normalizeName,
    normalizeTradeAccountName,
    buildSearchPayload,
    buildLeagueOptions,
    isTradeEnabledLeague,
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
    applyPriceOverrides,
    createSnapshot,
    appendHistory,
    compareSnapshots,
    toCsv,
    summaryText,
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
  const STATE_KEY = "poe2CurrencyWealthUserscriptStateV7";
  const LEGACY_STATE_KEY = "poe2CurrencyWealthUserscriptStateV5";
  const LEGACY_STATE_KEY_V6 = "poe2CurrencyWealthUserscriptStateV6";
  const CACHE_KEY = "poe2CurrencyWealthUserscriptPoeNinjaCacheV3";
  const HISTORY_KEY = "poe2CurrencyWealthHistoryV1";
  const OVERRIDE_KEY = "poe2CurrencyWealthOverridesV1";
  const PRICE_CACHE_TTL = 30 * 60 * 1000;
  let nextRequestAt = 0;
  let staticGroups = [];
  let localizedStaticGroups = [];
  let renderedResult = null;
  let currentSettings = null;
  let priceOverrides = {};
  let assetHistory = [];
  let lastSearchStats = null;
  let forcePriceRefreshRequested = false;

  const style = document.createElement("style");
  style.textContent = `
    #poe2-wealth-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483646;border:1px solid #d19a50;border-radius:999px;background:#16130f;color:#efbd77;padding:11px 17px;font:700 13px system-ui;cursor:pointer;box-shadow:0 8px 28px #0008}
    #poe2-wealth-overlay{position:fixed;inset:0;z-index:2147483647;background:#06080bd9;display:none;overflow:auto;color:#eef0f3;font:14px system-ui}
    #poe2-wealth-overlay.open{display:block}
    #poe2-wealth-overlay,#poe2-wealth-overlay *{box-sizing:border-box}
    .pw-shell{width:min(1120px,calc(100% - 40px));margin:28px auto 80px}
    .pw-head,.pw-form,.pw-summary,.pw-row{display:flex;align-items:center;gap:12px}
    .pw-head{justify-content:space-between}.pw-head h1{margin:0;font:400 32px Georgia;color:#f2f2f2}.pw-head p{margin:5px 0 0;color:#9da4af;font-size:13px}.pw-head button{font-size:22px}
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
    .pw-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.pw-toolbar input,.pw-toolbar select{height:38px;border:1px solid #383e48;border-radius:7px;background:#0b0e12;color:#fff;padding:0 10px}.pw-toolbar input[type=search]{min-width:220px;flex:1}.pw-alert{border-color:#9d3434!important;background:#2a1114!important;color:#fecaca}.pw-badge{display:inline-block;margin-left:6px;border-radius:999px;background:#3b2a16;color:#f5c57a;padding:2px 7px;font-size:10px}.pw-action{border:1px solid #464d59;border-radius:6px;background:#20252d;color:#ddd;padding:5px 8px;cursor:pointer}.pw-action:hover{border-color:#c38a43}.pw-details{margin-top:12px}.pw-details summary{cursor:pointer;color:#e4b46e;font-weight:700}.pw-unpriced-list,.pw-change-list{display:grid;gap:8px;margin-top:10px}.pw-unpriced-row{display:flex;align-items:center;gap:10px;border-bottom:1px solid #292e36;padding:8px 0}.pw-unpriced-row img{width:30px;height:30px;object-fit:contain}.pw-unpriced-row span:first-of-type{flex:1}.pw-history-chart{display:flex;align-items:end;gap:8px;height:130px;margin-top:14px;border-bottom:1px solid #343944}.pw-history-bar{position:relative;flex:1;min-width:10px;max-width:70px;background:#b67d36;border-radius:5px 5px 0 0}.pw-history-point{position:absolute;left:50%;top:0;width:10px;height:10px;border:2px solid #f2bf75;border-radius:50%;background:#12151a;transform:translate(-50%,-50%)}.pw-history-value{position:absolute;left:50%;top:-24px;transform:translateX(-50%);white-space:nowrap;color:#e4b46e;font-size:10px}.pw-history-empty{display:grid;place-items:center;height:110px;color:#8f96a2}.pw-history-list{display:grid;gap:6px;margin-top:12px}.pw-history-row{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#bfc4cc}.pw-evidence{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.pw-evidence span{border:1px solid #303640;border-radius:999px;padding:5px 9px;color:#b8bec8;font-size:11px}
    .pw-check{display:flex!important;grid-auto-flow:column;align-items:center;justify-content:start}.pw-check input{width:16px;height:16px}
    @media(max-width:850px){.pw-summary{grid-template-columns:1fr 1fr}.pw-groups{grid-template-columns:1fr 1fr}}
  `;
  document.documentElement.append(style);

  const launcher = document.createElement("button");
  launcher.id = "poe2-wealth-launcher";
  launcher.textContent = "Exile Ledger";
  document.body.append(launcher);

  const overlay = document.createElement("div");
  overlay.id = "poe2-wealth-overlay";
  overlay.innerHTML = `
    <main class="pw-shell">
      <header class="pw-head"><div><h1>Exile Ledger</h1><p>POE2 공개 창고 자산 분석 및 변동 추적</p></div><button class="pw-button secondary" data-close aria-label="엑자일 렛저 닫기">×</button></header>
      <section class="pw-panel pw-form">
        <label>계정명<div class="pw-inline"><input data-account placeholder="Account#1234"><button class="pw-button secondary" data-detect>감지</button></div></label>
        <label>리그<select data-league></select></label>
        <label class="pw-value-field">탭 표식 가격<div class="pw-inline"><input data-marker-price type="number" min="0.0001" step="any" value="1"><select data-marker-currency></select></div></label>
        <label class="pw-value-field">최소 표시 가치<div class="pw-inline"><input data-minimum type="number" min="0" step="0.1" value="0"><select data-minimum-currency></select></div></label>
        <label>가치 표시 단위<select data-display-currency></select></label>
        <label>가치 모드<select data-value-mode><option value="market">기준 가치</option><option value="liquidation">빠른 판매 예상</option></select></label>
        <label>빠른 판매 비율<input data-liquidation-rate type="number" min="1" max="100" value="80"></label>
        <button class="pw-button secondary" data-refresh type="button">poe.ninja 데이터 다시 받기</button>
        <button class="pw-button" data-sync>창고 동기화</button>
      </section>
      <div class="pw-status" data-status>poe.ninja 집계 데이터는 실시간 체결가가 아니며 최대 약 1시간 이상 지연될 수 있습니다.</div>
      <div class="pw-panel pw-alert" data-incomplete hidden>검색 결과 일부가 제한되어 실제 자산보다 적게 계산됐을 수 있습니다.</div>
      <section data-results hidden>
        <div class="pw-panel pw-summary">
          <article class="pw-card"><span>추적 가능한 총자산</span><strong data-total-value>-</strong></article>
          <article class="pw-card"><span>계산된 품목</span><strong data-priced-count>-</strong></article>
          <article class="pw-card"><span>가격 미확인</span><strong data-unpriced-count>-</strong></article>
          <article class="pw-card"><span>poe.ninja 데이터 수신 시각</span><strong data-price-updated>-</strong></article>
        </div>
        <div class="pw-evidence" data-evidence></div>
        <section class="pw-panel"><h2>보관함 종류별 자산</h2><p class="pw-note">실제 탭 이름이 아니라 아이템 종류를 기준으로 자동 분류합니다.</p><div class="pw-groups" data-storage-groups></div></section>
        <section class="pw-panel">
          <div class="pw-table-controls"><h2>가치가 높은 화폐성 아이템</h2><select data-group-filter aria-label="보관함 종류 선택"><option value="">모든 보관함 종류</option></select></div>
          <div class="pw-toolbar"><input data-item-search type="search" placeholder="아이템 이름 검색"><select data-sort><option value="total">총가치 높은 순</option><option value="unit">개당 가치 높은 순</option><option value="quantity">수량 높은 순</option><option value="name">이름순</option></select><select data-market-filter><option value="">모든 시세 상태</option><option value="low">거래량 낮음</option><option value="volatile">가격 변동 큼</option><option value="override">직접 지정</option></select><button class="pw-action" data-export-csv>CSV</button><button class="pw-action" data-copy-summary>요약 복사</button></div>
          <table class="pw-table"><thead><tr><th>아이템</th><th>보관함 종류</th><th class="num">수량</th><th class="num">개당 가치</th><th class="num">총가치</th><th>상태/설정</th></tr></thead><tbody data-items></tbody></table>
          <details class="pw-details"><summary>가격 미확인 품목 <span data-unpriced-inline>0</span>개</summary><div class="pw-unpriced-list" data-unpriced-list></div></details>
        </section>
        <section class="pw-panel">
          <div class="pw-table-controls"><h2>자산 변동 기록 <span class="pw-note" data-history-count>0개</span></h2><div><button class="pw-action" data-delete-history>전체 삭제</button></div></div>
          <div class="pw-history-chart" data-history-chart></div>
          <div class="pw-change-list" data-change-summary></div>
          <div class="pw-history-list" data-history-list></div>
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
    valueMode: $("[data-value-mode]"),
    liquidationRate: $("[data-liquidation-rate]"),
    refresh: $("[data-refresh]"),
    sync: $("[data-sync]"),
    status: $("[data-status]"),
    results: $("[data-results]"),
    totalValue: $("[data-total-value]"),
    pricedCount: $("[data-priced-count]"),
    unpricedCount: $("[data-unpriced-count]"),
    priceUpdated: $("[data-price-updated]"),
    incomplete: $("[data-incomplete]"),
    evidence: $("[data-evidence]"),
    storageGroups: $("[data-storage-groups]"),
    items: $("[data-items]"),
    groupFilter: $("[data-group-filter]"),
    itemSearch: $("[data-item-search]"),
    sort: $("[data-sort]"),
    marketFilter: $("[data-market-filter]"),
    exportCsv: $("[data-export-csv]"),
    copySummary: $("[data-copy-summary]"),
    unpricedInline: $("[data-unpriced-inline]"),
    unpricedList: $("[data-unpriced-list]"),
    historyChart: $("[data-history-chart]"),
    historyCount: $("[data-history-count]"),
    changeSummary: $("[data-change-summary]"),
    historyList: $("[data-history-list]"),
    deleteHistory: $("[data-delete-history]")
  };

  launcher.addEventListener("click", () => overlay.classList.add("open"));
  $("[data-close]").addEventListener("click", () => overlay.classList.remove("open"));
  $("[data-detect]").addEventListener("click", detectAccount);
  ui.sync.addEventListener("click", () => synchronize().catch(showError));
  ui.refresh.addEventListener("click", () => {
    forcePriceRefreshRequested = true;
    ui.refresh.textContent = "다음 동기화에서 다시 받음";
  });
  ui.groupFilter.addEventListener("change", () => renderItems());
  ui.itemSearch.addEventListener("input", () => renderItems());
  ui.sort.addEventListener("change", () => {
    renderItems();
    persistViewSettings().catch(showError);
  });
  ui.marketFilter.addEventListener("change", () => renderItems());
  ui.displayCurrency.addEventListener("change", () => {
    render(renderedResult);
    persistViewSettings().catch(showError);
  });
  ui.valueMode.addEventListener("change", () => {
    render(renderedResult);
    persistViewSettings().catch(showError);
  });
  ui.liquidationRate.addEventListener("change", () => {
    ui.liquidationRate.value = String(
      Math.max(1, Math.min(100, Number(ui.liquidationRate.value) || 80))
    );
    render(renderedResult);
    persistViewSettings().catch(showError);
  });
  ui.exportCsv.addEventListener("click", exportCsv);
  ui.copySummary.addEventListener("click", copySummary);
  ui.deleteHistory.addEventListener("click", () => clearHistory().catch(showError));

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
    const leagueOptions = core.buildLeagueOptions(leagues.result || []);
    ui.league.replaceChildren(
      ...leagueOptions.map((league) =>
        option(league.id, league.label, !league.tradeEnabled)
      )
    );

    const state =
      (await GM_getValue(STATE_KEY, null)) ||
      (await GM_getValue(LEGACY_STATE_KEY_V6, null)) ||
      (await GM_getValue(LEGACY_STATE_KEY, null));
    priceOverrides = await GM_getValue(OVERRIDE_KEY, {});
    assetHistory = await GM_getValue(HISTORY_KEY, {});
    if (state) {
      currentSettings = state;
      ui.account.value = core.normalizeTradeAccountName(state.accountName);
      if (
        leagueOptions.some(
          (league) => league.id === state.league && league.tradeEnabled
        )
      ) {
        ui.league.value = state.league;
      }
      ui.markerPrice.value = String(state.markerPrice ?? 1);
      ui.markerCurrency.value = state.markerCurrency || "mirror";
      ui.minimum.value = String(state.minimumValue ?? 0);
      ui.minimumCurrency.value = state.minimumCurrency || "exalted";
      ui.displayCurrency.value = state.displayCurrency || "exalted";
      ui.valueMode.value = state.valueMode || "market";
      ui.liquidationRate.value = String(state.liquidationRate ?? 80);
      ui.sort.value = state.sort || "total";
      if (state.result) {
        renderedResult = core.localizeResultNames(
          state.result,
          localizedStaticGroups
        );
        lastSearchStats = renderedResult.searchStats || null;
        render(renderedResult);
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
      valueMode: ui.valueMode.value,
      liquidationRate: Math.max(
        1,
        Math.min(100, Number(ui.liquidationRate.value) || 80)
      ),
      sort: ui.sort.value,
      forcePriceRefresh: forcePriceRefreshRequested
    };
    ui.account.value = settings.accountName;
    if (!settings.accountName) throw new Error("계정명을 입력하세요.");
    if (!settings.league) throw new Error("리그를 선택하세요.");
    if (!core.isTradeEnabledLeague(settings.league)) {
      throw new Error("SSF 리그는 공개 거래 검색을 지원하지 않아 계산할 수 없습니다.");
    }
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
        warnings.push(
          `poe.ninja 일부 카테고리 조회 실패로 이전 데이터를 사용했습니다: ${priceResult.staleCategories.join(", ")}`
        );
      }
      const overridden = core.applyPriceOverrides(
        priceResult.prices,
        priceOverrides,
        priceResult.rates
      );
      const result = core.buildResult(
        holdings,
        overridden.prices,
        priceResult.rates,
        settings.minimumValue,
        settings.minimumCurrency,
        {
          priceUpdatedAt: priceResult.updatedAt,
          usedStalePrices: priceResult.usedStalePrices,
          staleCategories: priceResult.staleCategories,
          priceGroups: priceResult.priceGroups,
          marketMeta: priceResult.marketMeta,
          priceSources: overridden.priceSources,
          basePrices: priceResult.prices,
          warnings
        }
      );
      result.searchStats = searchResults.stats;
      currentSettings = settings;
      lastSearchStats = searchResults.stats;
      const historyKey = historyScopeKey(settings);
      const previousHistory = assetHistory[historyKey] || [];
      assetHistory = {
        ...assetHistory,
        [historyKey]: core.appendHistory(
          previousHistory,
          core.createSnapshot(result, settings),
          90
        )
      };
      await GM_setValue(HISTORY_KEY, assetHistory);
      await GM_setValue(STATE_KEY, { ...settings, forcePriceRefresh: false, result });
      forcePriceRefreshRequested = false;
      ui.refresh.textContent = "poe.ninja 데이터 다시 받기";
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
    let incomplete = false;
    let requestCount = 0;
    for (let index = 0; index < core.ASSET_SEARCH_PARTITIONS.length; index += 1) {
      const partition = core.ASSET_SEARCH_PARTITIONS[index];
      setStatus(
        `화폐성 아이템 분할 검색 ${index + 1} / ${core.ASSET_SEARCH_PARTITIONS.length}`
      );
      const outcome = await searchPartition(settings, partition, 0);
      requestCount += outcome.requestCount;
      outcome.ids.forEach((id) => ids.add(id));
      warnings.push(...outcome.warnings);
      incomplete ||= outcome.incomplete;
    }
    return {
      ids: [...ids],
      warnings,
      stats: {
        resultIds: ids.size,
        requestCount,
        incomplete
      }
    };
  }

  async function searchPartition(settings, partition, depth) {
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
    const partitionIds = Array.isArray(search.result) ? search.result : [];
    const total = Number(search.total) || partitionIds.length;
    if (total <= partitionIds.length) {
      return {
        ids: partitionIds,
        warnings: [],
        incomplete: false,
        requestCount: 1
      };
    }

    const minimum = Number(partition.stackMin);
    const maximum = Number(partition.stackMax);
    if (
      partition.category === "currency" &&
      Number.isFinite(minimum) &&
      Number.isFinite(maximum) &&
      minimum < maximum &&
      depth < 20
    ) {
      const midpoint = Math.floor((minimum + maximum) / 2);
      const left = await searchPartition(
        settings,
        { ...partition, stackMin: minimum, stackMax: midpoint },
        depth + 1
      );
      const right = await searchPartition(
        settings,
        { ...partition, stackMin: midpoint + 1, stackMax: maximum },
        depth + 1
      );
      return {
        ids: [...new Set([...left.ids, ...right.ids])],
        warnings: [...left.warnings, ...right.warnings],
        incomplete: left.incomplete || right.incomplete,
        requestCount: 1 + left.requestCount + right.requestCount
      };
    }

    return {
      ids: partitionIds,
      warnings: [
        `${partition.category} 검색 결과 ${total}개 중 ${partitionIds.length}개만 수집`
      ],
      incomplete: true,
      requestCount: 1
    };
  }

  async function loadPoeNinjaPrices(league, forceRefresh) {
    const allCaches = await GM_getValue(CACHE_KEY, {});
    const leagueCache = allCaches[league] || { categories: {} };
    const categories = { ...(leagueCache.categories || {}) };
    const staleCategories = [];
    const overviews = [];

    for (let index = 0; index < core.POE_NINJA_PRICE_TYPES.length; index += 1) {
      const type = core.POE_NINJA_PRICE_TYPES[index];
      const cachedCategory = categories[type];
      const cachedAt = new Date(cachedCategory?.updatedAt || 0).getTime();
      const categoryFresh =
        !forceRefresh &&
        cachedCategory?.data &&
        Date.now() - cachedAt < PRICE_CACHE_TTL;
      setStatus(
        `poe.ninja 데이터 ${type} · ${index + 1} / ${core.POE_NINJA_PRICE_TYPES.length}`
      );

      if (categoryFresh) {
        overviews.push({ ...cachedCategory.data, priceType: type });
        continue;
      }

      try {
        const data = await ninjaRequest(
          `${POE_NINJA_ROOT}?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`
        );
        categories[type] = {
          data,
          updatedAt: new Date().toISOString()
        };
        overviews.push({ ...data, priceType: type });
      } catch (error) {
        if (!cachedCategory?.data) throw error;
        staleCategories.push(type);
        overviews.push({ ...cachedCategory.data, priceType: type });
      }
    }

    const parsed = core.parsePoeNinjaPrices(overviews);
    if (!parsed.rates.chaos || !parsed.rates.divine || !parsed.rates.annul) {
      throw new Error("poe.ninja에서 카오스·딥·소멸 환율을 찾지 못했습니다.");
    }
    const updatedAt = Object.values(categories)
      .map((category) => category.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || new Date().toISOString();
    allCaches[league] = { categories };
    await GM_setValue(CACHE_KEY, allCaches);
    return {
      prices: parsed.prices,
      priceGroups: parsed.priceGroups,
      marketMeta: parsed.marketMeta,
      rates: parsed.rates,
      updatedAt,
      staleCategories,
      usedStalePrices: staleCategories.length > 0
    };
  }

  async function ninjaRequest(url) {
    const response = await gmRequest(url, { anonymous: true });
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
        anonymous: Boolean(options.anonymous),
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
    const multiplier = valueMultiplier();
    ui.totalValue.textContent = formatExaltedValue(
      result.totalExalted * multiplier,
      result.rates,
      currency
    );
    ui.pricedCount.textContent = (
      result.pricedItems || result.visibleItems
    ).length.toLocaleString();
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
    renderUnpriced();
    renderEvidence();
    renderHistory();
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
    const multiplier = valueMultiplier();
    const query = core.normalizeName(ui.itemSearch.value);
    const marketFilter = ui.marketFilter.value;
    const items = [...renderedResult.visibleItems]
      .filter((item) => !selectedGroup || item.storageGroup === selectedGroup)
      .filter((item) => !query || core.normalizeName(item.name).includes(query))
      .filter((item) => {
        if (marketFilter === "low") return item.market?.lowVolume;
        if (marketFilter === "volatile") return item.market?.volatile;
        if (marketFilter === "override") return item.priceSource === "직접 지정";
        return true;
      })
      .sort(itemComparator(ui.sort.value));
    ui.items.replaceChildren(
      ...items.map((item) => {
        const row = document.createElement("tr");
        row.innerHTML = `<td></td><td></td><td class="num"></td><td class="num"></td><td class="num"></td><td></td>`;
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
          item.unitExalted * multiplier,
          renderedResult.rates,
          currency
        );
        row.children[4].textContent = formatExaltedValue(
          item.totalExalted * multiplier,
          renderedResult.rates,
          currency
        );
        const statusCell = row.children[5];
        if (item.priceSource === "직접 지정") {
          statusCell.append(badge("직접 지정"));
        }
        if (item.market?.lowVolume) statusCell.append(badge("거래량 낮음"));
        if (item.market?.volatile) statusCell.append(badge("가격 변동 큼"));
        const priceButton = document.createElement("button");
        priceButton.className = "pw-action";
        priceButton.textContent =
          item.priceSource === "직접 지정" ? "가격 수정" : "직접 가격";
        priceButton.addEventListener("click", () =>
          editOverride(item).catch(showError)
        );
        statusCell.append(priceButton);
        if (item.priceSource === "직접 지정") {
          const resetButton = document.createElement("button");
          resetButton.className = "pw-action";
          resetButton.textContent = "초기화";
          resetButton.addEventListener("click", () =>
            removeOverride(item.tradeId).catch(showError)
          );
          statusCell.append(resetButton);
        }
        return row;
      })
    );
  }

  function renderStorageGroups(rows) {
    const currency = selectedDisplayCurrency();
    const multiplier = valueMultiplier();
    ui.storageGroups.replaceChildren(
      ...rows.map((entry) => {
        const row = document.createElement("div");
        row.className = "pw-row pw-group-row";
        const name = document.createElement("span");
        name.textContent = entry.name;
        const value = document.createElement("strong");
        value.className = "pw-value";
        value.textContent = formatExaltedValue(
          entry.totalExalted * multiplier,
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

  function valueMultiplier() {
    return ui.valueMode.value === "liquidation"
      ? Math.max(0.01, Math.min(1, Number(ui.liquidationRate.value) / 100))
      : 1;
  }

  function itemComparator(sortMode) {
    if (sortMode === "unit") {
      return (left, right) => right.unitExalted - left.unitExalted;
    }
    if (sortMode === "quantity") {
      return (left, right) => right.quantity - left.quantity;
    }
    if (sortMode === "name") {
      return (left, right) => left.name.localeCompare(right.name, "ko");
    }
    return (left, right) => right.totalExalted - left.totalExalted;
  }

  async function persistViewSettings() {
    const state = (await GM_getValue(STATE_KEY, null)) || {};
    await GM_setValue(STATE_KEY, {
      ...state,
      displayCurrency: ui.displayCurrency.value,
      valueMode: ui.valueMode.value,
      liquidationRate: Number(ui.liquidationRate.value),
      sort: ui.sort.value,
      ...(renderedResult ? { result: renderedResult } : {})
    });
  }

  function renderUnpriced() {
    const items = renderedResult?.unpricedItems || [];
    ui.unpricedInline.textContent = items.length.toLocaleString();
    ui.unpricedList.replaceChildren(
      ...items.map((item) => {
        const row = document.createElement("div");
        row.className = "pw-unpriced-row";
        if (item.image) {
          const image = document.createElement("img");
          image.src = item.image;
          image.alt = "";
          row.append(image);
        }
        const name = document.createElement("span");
        name.textContent = `${item.name} · ${item.storageGroup} · ${item.quantity.toLocaleString()}개`;
        const reason = document.createElement("span");
        reason.textContent = "poe.ninja 시세 없음";
        const button = document.createElement("button");
        button.className = "pw-action";
        button.textContent = "직접 가격";
        button.addEventListener("click", () => editOverride(item).catch(showError));
        row.append(name, reason, button);
        return row;
      })
    );
  }

  function renderEvidence() {
    const stats = renderedResult?.searchStats || lastSearchStats || {};
    const staleCategories = renderedResult?.staleCategories?.length
      ? `이전 캐시: ${renderedResult.staleCategories.join(", ")}`
      : "새 데이터/유효 캐시";
    const values = [
      `검색 항목 ${stats.resultIds ?? "-"}개`,
      `계산 품목 ${(renderedResult?.pricedItems || []).length}개`,
      `가격 미확인 ${(renderedResult?.unpricedItems || []).length}개`,
      `거래량 낮음 ${renderedResult?.lowVolumeCount || 0}개`,
      `가격 변동 큼 ${renderedResult?.volatileCount || 0}개`,
      `시세 출처 ${staleCategories}`
    ];
    ui.evidence.replaceChildren(
      ...values.map((value) => {
        const item = document.createElement("span");
        item.textContent = value;
        return item;
      })
    );
    ui.incomplete.hidden = !stats.incomplete;
  }

  function renderHistory() {
    const settings = currentSettings || {};
    const history = assetHistory[historyScopeKey(settings)] || [];
    const currency = selectedDisplayCurrency();
    const rate = Number(renderedResult?.rates?.[currency.id]) || 1;
    const multiplier = valueMultiplier();
    const maximum = Math.max(1, ...history.map((item) => item.totalExalted));
    ui.historyCount.textContent = `${history.length.toLocaleString()}개`;
    if (history.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pw-history-empty";
      empty.textContent = "동기화 후 자산 기록이 생성됩니다.";
      ui.historyChart.replaceChildren(empty);
    } else {
      ui.historyChart.replaceChildren(
        ...history.map((snapshot) => {
        const bar = document.createElement("div");
        bar.className = "pw-history-bar";
        bar.style.height = `${Math.max(12, (snapshot.totalExalted / maximum) * 100)}%`;
        bar.title = `${formatDateTime(snapshot.createdAt)} · ${format(
          (snapshot.totalExalted / rate) * multiplier
        )} ${currency.short}`;
        const point = document.createElement("span");
        point.className = "pw-history-point";
        bar.append(point);
        if (history.length === 1) {
          const value = document.createElement("span");
          value.className = "pw-history-value";
          value.textContent = `${format(
            (snapshot.totalExalted / rate) * multiplier
          )} ${currency.short}`;
          bar.append(value);
        }
        return bar;
        })
      );
    }

    const previous = history.at(-2);
    const current = history.at(-1);
    const comparison = core.compareSnapshots(previous, current);
    ui.changeSummary.replaceChildren();
    if (comparison) {
      for (const text of [
        `총자산 변화 ${signedValue(comparison.totalChangeExalted, rate, multiplier, currency)}`,
        `수량 변화 영향 ${signedValue(comparison.quantityChangeExalted, rate, multiplier, currency)}`,
        `시세 변화 영향 ${signedValue(comparison.priceChangeExalted, rate, multiplier, currency)}`,
        `신규 ${comparison.newItems.length}개 · 소진 ${comparison.depletedItems.length}개`,
        comparison.newItems.length
          ? `신규 품목: ${comparison.newItems.map((item) => item.name).join(", ")}`
          : "",
        comparison.depletedItems.length
          ? `소진 품목: ${comparison.depletedItems
              .map((item) => item.name)
              .join(", ")}`
          : ""
      ]) {
        if (!text) continue;
        const line = document.createElement("div");
        line.textContent = text;
        ui.changeSummary.append(line);
      }
    }

    ui.historyList.replaceChildren(
      ...history
        .slice(-10)
        .reverse()
        .map((snapshot) => {
          const row = document.createElement("div");
          row.className = "pw-history-row";
          const text = document.createElement("span");
          text.textContent = `${formatDateTime(snapshot.createdAt)} · ${format(
            (snapshot.totalExalted / rate) * multiplier
          )} ${currency.short}`;
          const button = document.createElement("button");
          button.className = "pw-action";
          button.textContent = "삭제";
          button.addEventListener("click", () =>
            deleteHistoryEntry(snapshot.id).catch(showError)
          );
          row.append(text, button);
          return row;
        })
    );
  }

  async function editOverride(item) {
    const existing = priceOverrides[item.tradeId];
    const amount = prompt(
      `${item.name}의 개당 가격을 입력하세요.`,
      existing?.value ? String(existing.value) : ""
    );
    if (amount === null) return;
    const value = Number(amount);
    if (!(value > 0)) throw new Error("직접 가격은 0보다 커야 합니다.");
    const currency = prompt(
      "화폐 단위를 입력하세요: exalted, chaos, annul, divine",
      existing?.currency || ui.displayCurrency.value || "exalted"
    );
    if (currency === null) return;
    if (!core.DISPLAY_CURRENCIES.some((entry) => entry.id === currency)) {
      throw new Error("화폐 단위는 exalted, chaos, annul, divine 중 하나여야 합니다.");
    }
    priceOverrides = {
      ...priceOverrides,
      [item.tradeId]: { value, currency }
    };
    await GM_setValue(OVERRIDE_KEY, priceOverrides);
    await rebuildWithOverrides();
  }

  async function removeOverride(tradeId) {
    const next = { ...priceOverrides };
    delete next[tradeId];
    priceOverrides = next;
    await GM_setValue(OVERRIDE_KEY, priceOverrides);
    await rebuildWithOverrides();
  }

  async function rebuildWithOverrides() {
    if (!renderedResult) return;
    const allItems = [
      ...(renderedResult.pricedItems || renderedResult.visibleItems || []),
      ...(renderedResult.unpricedItems || [])
    ];
    const holdings = allItems.map((item) => ({
      tradeId: item.tradeId,
      name: item.name,
      image: item.image,
      group: item.group,
      category: item.category,
      tabName: item.tabName,
      quantity: item.quantity,
      stackCount: item.stackCount
    }));
    const basePrices = { ...(renderedResult.basePrices || {}) };
    for (const item of allItems) {
      if (item.marketUnitExalted > 0) {
        basePrices[item.tradeId] = item.marketUnitExalted;
      }
    }
    const overridden = core.applyPriceOverrides(
      basePrices,
      priceOverrides,
      renderedResult.rates
    );
    const rebuilt = core.buildResult(
      holdings,
      overridden.prices,
      renderedResult.rates,
      renderedResult.minimumValue,
      renderedResult.minimumCurrency,
      {
        priceUpdatedAt: renderedResult.priceUpdatedAt,
        usedStalePrices: renderedResult.usedStalePrices,
        staleCategories: renderedResult.staleCategories,
        warnings: renderedResult.warnings,
        priceGroups: renderedResult.priceGroups,
        marketMeta: renderedResult.marketMeta,
        priceSources: overridden.priceSources,
        basePrices
      }
    );
    rebuilt.searchStats = renderedResult.searchStats;
    renderedResult = rebuilt;
    const state = (await GM_getValue(STATE_KEY, null)) || {};
    await GM_setValue(STATE_KEY, { ...state, result: rebuilt });
    render(rebuilt);
  }

  function exportCsv() {
    if (!renderedResult) return;
    const csv = core.toCsv(
      renderedResult,
      ui.displayCurrency.value,
      valueMultiplier()
    );
    const blob = new Blob([`\ufeff${csv}`], {
      type: "text/csv;charset=utf-8"
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `poe2-assets-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function copySummary() {
    if (!renderedResult) return;
    await navigator.clipboard.writeText(
      core.summaryText(
        renderedResult,
        ui.displayCurrency.value,
        valueMultiplier()
      )
    );
    setStatus("자산 요약을 클립보드에 복사했습니다.");
  }

  async function clearHistory() {
    const key = historyScopeKey(currentSettings || {});
    assetHistory = { ...assetHistory, [key]: [] };
    await GM_setValue(HISTORY_KEY, assetHistory);
    renderHistory();
  }

  async function deleteHistoryEntry(id) {
    const key = historyScopeKey(currentSettings || {});
    assetHistory = {
      ...assetHistory,
      [key]: (assetHistory[key] || []).filter((entry) => entry.id !== id)
    };
    await GM_setValue(HISTORY_KEY, assetHistory);
    renderHistory();
  }

  function historyScopeKey(settings) {
    return `${settings.accountName || ""}\u0000${settings.league || ""}`;
  }

  function badge(text) {
    const item = document.createElement("span");
    item.className = "pw-badge";
    item.textContent = text;
    return item;
  }

  function signedValue(exalted, rate, multiplier, currency) {
    const value = (exalted / rate) * multiplier;
    return `${value >= 0 ? "+" : ""}${format(value)} ${currency.short}`;
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
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

  function option(value, text, disabled = false) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = text;
    item.disabled = disabled;
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

