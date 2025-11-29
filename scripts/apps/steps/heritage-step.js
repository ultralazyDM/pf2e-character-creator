"use strict";

/**
 * Шаг наследия для PF2ECharacterMasterApp.
 * Этот файл расширяет (или переопределяет) методы класса, объявленного в character-master.js.
 */
(function registerHeritageStep(appClass) {
    if (!appClass) return;

    /**
     * Догружает подробное описание наследия.
     * Вызывается, когда находимся на шаге "heritage" и выбран конкретный heritage.
     */
    appClass.prototype._ensureHeritageDetails = async function (heritage) {
        if (!heritage || heritage._detailsReady) return;

        const descriptionRaw = heritage.descriptionRaw ?? "";
        const description = await this._enrichHTML(descriptionRaw);

        heritage.description = description;
        heritage._detailsReady = true;
    };

    /**
     * Загружает список наследий из компендиев PF2e.
     * Результат кэшируется в this._cache.heritages.
     * Если ancestrySlug передан — фильтруем по родословной.
     */
    appClass.prototype._loadHeritages = async function (ancestrySlug) {
        // Если уже загружали — используем кэш
        if (!this._cache.heritages) {
            const pack =
                game.packs.get("pf2e.heritages") ||
                game.packs.get("pf2e.heritages-core") ||
                game.packs.get("pf2e.heritages-db");

            if (!pack) {
                console.warn(
                    "PF2E Character Master | Компендий с наследиями не найден."
                );
                this._cache.heritages = [];
            } else {
                try {
                    const docs = await pack.getDocuments();
                    const heritages = [];

                    for (const doc of docs) {
                        const sys = doc.system ?? {};

                        // Ссылка на родословную
                        const anc = sys.ancestry ?? {};
                        const slug = anc.slug ?? null;
                        const ancName = anc.name ?? null;

                        // Описание
                        const descriptionRaw = sys.description?.value ?? "";

                        heritages.push({
                            id: doc.id,
                            name: doc.name,
                            img: doc.img ?? null,
                            ancestrySlug: slug,
                            ancestryName: ancName,
                            descriptionRaw,
                            description: "",
                            _detailsReady: false
                        });
                    }

                    this._cache.heritages = heritages;
                } catch (err) {
                    console.error(
                        "PF2E Character Master | Ошибка при загрузке наследий:",
                        err
                    );
                    this._cache.heritages = [];
                }
            }
        }

        // Если родословная не выбрана — возвращаем всё
        if (!ancestrySlug) return this._cache.heritages;

        // Фильтруем по slug родословной, но оставляем универсальные (без ancestrySlug)
        return this._cache.heritages.filter(
            (h) => !h.ancestrySlug || h.ancestrySlug === ancestrySlug
        );
    };
})(PF2ECharacterMasterApp);
