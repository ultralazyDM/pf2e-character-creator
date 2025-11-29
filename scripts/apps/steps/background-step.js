"use strict";

/**
 * Шаг предысторий для PF2ECharacterMasterApp.
 * Этот файл расширяет (или переопределяет) методы класса, объявленного в character-master.js.
 */
(function registerBackgroundStep(appClass) {
    if (!appClass) return;

    /**
     * Догружает подробное описание и особенности предыстории.
     * Использует уже существующий хелпер this._enrichHTML.
     *
     * @param {object} background - объект предыстории из _loadBackgrounds
     */
    appClass.prototype._ensureBackgroundDetails = async function (background) {
        if (!background || background._detailsReady) return;

        const descriptionRaw = background.descriptionRaw ?? "";
        const featureRefs = background.featureRefs ?? [];

        const description = await this._enrichHTML(descriptionRaw);

        const features = [];
        for (const ref of featureRefs) {
            const uuid = ref.uuid;
            const name = ref.name;
            if (!uuid || !name) continue;

            const html = await this._enrichHTML(`@UUID[${uuid}]{${name}}`);
            features.push({ id: uuid, html });
        }

        background.description = description;
        background.features = features;
        background._detailsReady = true;
    };

    /**
     * Загружает список предысторий из компендиев PF2e.
     * Результат кэшируется в this._cache.backgrounds.
     *
     * Структура возвращаемого объекта полностью совпадает
     * с тем, что ожидает текущий шаблон и остальной код мастера.
     */
    appClass.prototype._loadBackgrounds = async function () {
        if (this._cache.backgrounds) return this._cache.backgrounds;

        const pack =
            game.packs.get("pf2e.backgrounds") ||
            game.packs.get("pf2e.backgrounds-srd") ||
            game.packs.get("pf2e.backgrounds-db");

        if (!pack) {
            console.warn(
                "PF2E Character Master | Компендий с предысториями не найден."
            );
            this._cache.backgrounds = [];
            return this._cache.backgrounds;
        }

        try {
            const docs = await pack.getDocuments();
            const backgrounds = [];

            for (const doc of docs) {
                const sys = doc.system ?? {};

                // Бонусы к характеристикам (слоты повышений)
                const boosts = this._extractBoostSlots(sys.boosts);

                // Обученные навыки
                const skills = this._extractTrainedSkills(sys);

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
                    const embedded = doc.items.contents;
                    for (const item of embedded) {
                        featureRefs.push({ uuid: item.uuid, name: item.name });
                    }
                }

                backgrounds.push({
                    id: doc.id,
                    name: doc.name,
                    img: doc.img ?? null,
                    boosts,
                    skills,
                    descriptionRaw,
                    featureRefs,
                    description: "",
                    features: [],
                    _detailsReady: false
                });
            }

            this._cache.backgrounds = backgrounds;
            return this._cache.backgrounds;
        } catch (err) {
            console.error(
                "PF2E Character Master | Ошибка при загрузке предысторий:",
                err
            );
            this._cache.backgrounds = [];
            return this._cache.backgrounds;
        }
    };
})(PF2ECharacterMasterApp);
