"use strict";

/**
 * Шаг родословной для PF2ECharacterMasterApp.
 * Этот файл расширяет (или переопределяет) методы класса, объявленного в character-master.js.
 */
(function registerAncestryStep(appClass) {
  if (!appClass) return;

  /**
   * Догружает подробное описание и особенности родословной.
   * Вызывается, когда мы находимся на шаге "ancestry" и выбран конкретный ancestry.
   */
  appClass.prototype._ensureAncestryDetails = async function (ancestry) {
    if (!ancestry || ancestry._detailsReady) return;

    const descriptionRaw = ancestry.descriptionRaw ?? "";
    const featureRefs = ancestry.featureRefs ?? [];

    const description = await this._enrichHTML(descriptionRaw);

    const features = [];
    for (const ref of featureRefs) {
      const uuid = ref.uuid;
      const name = ref.name;
      if (!uuid || !name) continue;

      const html = await this._enrichHTML(`@UUID[${uuid}]{${name}}`);
      features.push({ id: uuid, html });
    }

    ancestry.description = description;
    ancestry.features = features;
    ancestry._detailsReady = true;
  };

  /**
   * Загружает список родословных из компендиев PF2e.
   * Результат кэшируется в this._cache.ancestries.
   */
  appClass.prototype._loadAncestries = async function () {
    if (this._cache.ancestries) return this._cache.ancestries;

    const pack =
      game.packs.get("pf2e.ancestries") ||
      game.packs.get("pf2e.ancestries-core") ||
      game.packs.get("pf2e.ancestries-db");

    if (!pack) {
      console.warn("PF2E Character Master | Компендий с родословными не найден.");
      this._cache.ancestries = [];
      return this._cache.ancestries;
    }

    try {
      const docs = await pack.getDocuments();
      const ancestries = [];

      for (const doc of docs) {
        const sys = doc.system ?? {};

        // slug
        const slug = sys.slug ?? null;

        // HP
        let hp = sys.hp ?? null;
        if (typeof hp === "object" && hp !== null) {
          hp = hp.value ?? hp.perLevel ?? hp.max ?? null;
        }

        // Скорость
        let speed = null;
        if (typeof sys.speed === "number") {
          speed = sys.speed;
        } else if (typeof sys.speed?.value === "number") {
          speed = sys.speed.value;
        } else if (typeof sys.attributes?.speed?.value === "number") {
          speed = sys.attributes.speed.value;
        }

        // Размер
        const sizeKey = sys.size ?? null;
        const sizeLabel = this._sizeLabel(sizeKey);

        // Бонусы/изъяны характеристик
        const boosts = this._extractAncestryBoosts(sys);
        const flaws = this._extractFlaws(sys);

        // Языки
        const langsRaw = sys.languages?.value ?? sys.languages ?? [];
        const languages = Array.isArray(langsRaw)
          ? langsRaw.map((k) => this._languageLabel(k))
          : [];

        // Доп. языки (кол-во)
        const additionalLanguages =
          sys.additionalLanguages?.count ??
          sys.additionalLanguages?.value ??
          sys.additionalLanguages ??
          0;

        // Описание
        const descriptionRaw = sys.description?.value ?? "";

        // Особенности (фичи) — ссылки на предметы / фиты
        const featureRefs = [];
        const sysItemsRaw = sys.items ?? [];
        const sysItems = Array.isArray(sysItemsRaw)
          ? sysItemsRaw
          : Object.values(sysItemsRaw);

        for (const entry of sysItems) {
          if (!entry) continue;
          const uuid = entry.uuid ?? entry.item ?? entry.id;
          const name = entry.name ?? entry.label ?? entry.slug;
          if (!uuid || !name) continue;
          featureRefs.push({ uuid, name });
        }

        // Если в системных данных фич нет, пробуем вытащить вложенные предметы актора
        if (!featureRefs.length && doc.items?.size) {
          for (const item of doc.items.contents) {
            featureRefs.push({ uuid: item.uuid, name: item.name });
          }
        }

        ancestries.push({
          id: doc.id,
          name: doc.name,
          img: doc.img ?? null,
          slug,
          hp,
          speed,
          sizeLabel,
          boosts,
          flaws,
          languages,
          additionalLanguages,
          descriptionRaw,
          featureRefs,
          description: "",
          features: [],
          _detailsReady: false
        });
      }

      this._cache.ancestries = ancestries;
      return ancestries;
    } catch (err) {
      console.error("PF2E Character Master | Ошибка при загрузке родословных:", err);
      this._cache.ancestries = [];
      return this._cache.ancestries;
    }
  };

})(PF2ECharacterMasterApp);
