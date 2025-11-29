"use strict";

/**
 * Шаг «Подкласс / ключевой выбор» для PF2ECharacterMasterApp.
 *
 * Логика:
 * 1. Находим выбранный класс.
 * 2. Догружаем подробности класса (_ensureClassDetails), чтобы были keyChoices и правила.
 * 3. Берём keyChoices и фильтруем только те, что выглядят как «подкласс»:
 *    - есть правило ChoiceSet;
 *    - slug похож на doctrine / muse / school / research / instinct / order / lesson и т.п.
 * 4. Для ChoiceSet:
 *    - если внутри есть явный массив choices → разворачиваем каждую choice в отдельный «подкласс»
 *      и пытаемся найти настоящий фит в компендии pf2e.classfeatures по слагу;
 *    - если внутри choices.filter с item:tag:... → ищем соответствующие предметы в компендии
 *      pf2e.classfeatures и тоже превращаем каждый найденный элемент в «подкласс»;
 *    - иначе оставляем сам источник ChoiceSet как один вариант (как сейчас у Муз барда без тегов).
 */

Hooks.once("init", () => {
    const appClass = globalThis.PF2ECharacterMasterApp;
    if (!appClass) {
        console.warn(
            "PF2E Character Master | subclass-step: PF2ECharacterMasterApp not found, patch skipped."
        );
        return;
    }

    // -------------------------------------------------------------------------
    // Кеш для компендия с классовыми особенностями
    // -------------------------------------------------------------------------

    let cachedClassFeatures = null;

    async function getClassFeatureDocs() {
        if (cachedClassFeatures) return cachedClassFeatures;

        const pack =
            game.packs.get("pf2e.classfeatures") ||
            game.packs.get("pf2e.classfeatures-srd") ||
            game.packs.get("pf2e.classfeatures-db");

        if (!pack) {
            console.warn(
                "PF2E Character Master | subclass-step: classfeatures compendium not found."
            );
            cachedClassFeatures = [];
            return cachedClassFeatures;
        }

        try {
            cachedClassFeatures = await pack.getDocuments();
        } catch (e) {
            console.error(
                "PF2E Character Master | subclass-step: failed to load classfeatures pack:",
                e
            );
            cachedClassFeatures = [];
        }

        return cachedClassFeatures;
    }

    /**
     * Разворачивает ChoiceSet, где choices заданы через filter с item:tag:...
     * Возвращает массив объектов подклассов.
     *
     * @param {object} choicesSpec   choiceSetRule.choices
     * @param {string} parentUuid    UUID исходной особенности (Музы, Доктрина и т.п.)
     * @param {PF2ECharacterMasterApp} app  инстанс мастера, чтобы вызывать _enrichHTML
     */
    async function resolveTagBasedChoices(choicesSpec, parentUuid, app) {
        if (!choicesSpec) return [];

        const filters = Array.isArray(choicesSpec.filter)
            ? choicesSpec.filter
            : typeof choicesSpec.filter === "string"
                ? [choicesSpec.filter]
                : [];

        const tags = [];
        for (const f of filters) {
            const m = /^item:tag:(.+)$/i.exec(f);
            if (m && m[1]) tags.push(m[1]);
        }

        if (!tags.length) return [];

        const docs = await getClassFeatureDocs();
        if (!docs.length) return [];

        const subclasses = [];

        for (const doc of docs) {
            const sys = doc.system ?? {};

            // В PF2e тэги для item:tag:... как раз лежат в traits.otherTags,
            // а не только в обычных traits.value.
            const traitsRaw = sys.traits ?? {};
            const value = Array.isArray(traitsRaw.value) ? traitsRaw.value : [];
            const other =
                Array.isArray(traitsRaw.otherTags)
                    ? traitsRaw.otherTags
                    : Array.isArray(traitsRaw.other)
                        ? traitsRaw.other
                        : [];

            const traitValues = [...value, ...other].map((t) => String(t));
            if (!traitValues.length) continue;

            const hasTag = traitValues.some((t) => tags.includes(t));
            if (!hasTag) continue;

            const label = doc.name ?? sys.slug ?? doc.id;
            let html = "";

            try {
                if (typeof app._enrichHTML === "function") {
                    html = await app._enrichHTML(`@UUID[${doc.uuid}]{${doc.name}}`);
                }
            } catch (e) {
                console.warn(
                    "PF2E Character Master | subclass-step: enrichHTML failed for",
                    doc.uuid,
                    e
                );
            }

            subclasses.push({
                id: doc.uuid,
                parentId: parentUuid,
                value: sys.slug ?? doc.slug ?? doc.id,
                label,
                name: label,
                html
            });
        }

        console.debug(
            "PF2ECM | subclass-step: resolveTagBasedChoices",
            { parentUuid, tags, count: subclasses.length }
        );

        return subclasses;
    }

    /**
     * Пытаемся построить HTML описания подкласса по слагу из компендия classfeatures.
     * Если не вышло — возвращаем baseHtml как есть.
     *
     * @param {string} baseHtml
     * @param {string} slugOrValue
     * @param {PF2ECharacterMasterApp} app
     */
    async function enrichSubclassHTMLFromSlug(baseHtml, slugOrValue, app) {
        if (baseHtml) return baseHtml;
        if (!slugOrValue) return baseHtml;

        const docs = await getClassFeatureDocs();
        if (!docs.length) return baseHtml;

        const slugStr = String(slugOrValue);

        const doc = docs.find((d) => {
            const sys = d.system ?? {};
            const s =
                sys.slug ??
                d.slug ??
                d.id ??
                "";
            return String(s) === slugStr;
        });

        if (!doc) return baseHtml;

        try {
            if (typeof app._enrichHTML === "function") {
                return await app._enrichHTML(`@UUID[${doc.uuid}]{${doc.name}}`);
            }
        } catch (e) {
            console.warn(
                "PF2E Character Master | subclass-step: enrichSubclassHTMLFromSlug failed for",
                slugStr,
                e
            );
        }

        return baseHtml;
    }

    // -------------------------------------------------------------------------
    // 1) Добавляем шаг "subclass" между "class" и "abilities"
    // -------------------------------------------------------------------------

    if (Array.isArray(appClass.STEP_IDS) && !appClass.STEP_IDS.includes("subclass")) {
        const order = [...appClass.STEP_IDS];
        const idxAbilities = order.indexOf("abilities");
        if (idxAbilities >= 0) {
            order.splice(idxAbilities, 0, "subclass");
        } else {
            order.push("subclass");
        }
        appClass.STEP_IDS = order;
    }

    // -------------------------------------------------------------------------
    // 2) Патчим _prepareContext для шага "subclass"
    // -------------------------------------------------------------------------

    const originalPrepareContext = appClass.prototype._prepareContext;

    appClass.prototype._prepareContext = async function () {
        const ctx = await originalPrepareContext.call(this);

        if (this.currentStepId !== "subclass") return ctx;

        // ---------- 2.1. Находим текущий класс ----------
        let classes = Array.isArray(ctx.classes) ? ctx.classes : [];
        if (!classes.length && typeof this._loadClasses === "function") {
            try {
                classes = await this._loadClasses();
            } catch (e) {
                console.warn("PF2ECM | subclass-step: _loadClasses failed", e);
            }
        }

        const classId = this.draft?.classId ?? ctx.selectedClassId ?? null;
        let currentClass = null;

        if (classId && classes.length) {
            currentClass = classes.find((c) => c.id === classId) ?? null;
        }

        if (currentClass && typeof this._ensureClassDetails === "function") {
            try {
                await this._ensureClassDetails(currentClass);
            } catch (e) {
                console.warn("PF2ECM | subclass-step: _ensureClassDetails failed", e);
            }
        }

        if (!currentClass) {
            ctx.subclasses = [];
            ctx.selectedSubclassId = this.draft?.subclassId ?? null;
            ctx.currentClass = null;
            return ctx;
        }

        // ---------- 2.2. Фильтруем keyChoices на «подклассовые» ----------
        const rawChoices = Array.isArray(currentClass.keyChoices)
            ? currentClass.keyChoices
            : [];

        const subclasses = [];

        // Эвристика по slug'ам подклассов
        const SUBCLASS_SLUG_RE =
            /(muse|doctrine|school|thesis|research|instinct|order|lesson)/i;

        for (let i = 0; i < rawChoices.length; i++) {
            const choice = rawChoices[i];
            const uuid = choice.id ?? choice.uuid;
            if (!uuid || typeof uuid !== "string") continue;

            let doc = null;
            try {
                // eslint-disable-next-line no-undef
                doc = await fromUuid(uuid);
            } catch (e) {
                console.warn("PF2ECM | subclass-step: fromUuid failed for", uuid, e);
            }
            if (!doc || !doc.system) continue;

            const slug =
                doc.system.slug ??
                doc.slug ??
                choice.slug ??
                "";

            const rules = Array.isArray(doc.system.rules) ? doc.system.rules : [];
            const choiceSetRule = rules.find(
                (r) => r && (r.key === "ChoiceSet" || r.key === "ChoiceSetRuleElement")
            );

            if (!choiceSetRule) continue;
            if (!SUBCLASS_SLUG_RE.test(slug)) continue;

            const ruleChoices = choiceSetRule.choices;

            // ---- 2.2.1. Если в правиле есть явный массив choices → разворачиваем их ----
            if (Array.isArray(ruleChoices) && ruleChoices.length) {
                for (const ch of ruleChoices) {
                    const value = ch.value ?? ch.slug ?? ch.id ?? "";
                    if (!value) continue;

                    const labelRaw =
                        ch.label ??
                        ch.name ??
                        value;

                    const label =
                        typeof labelRaw === "string"
                            ? game.i18n.localize(labelRaw)
                            : String(labelRaw);

                    let html = choice.html ?? "";

                    // Пытаемся найти настоящий фит по слагу value и обогатить HTML
                    html = await enrichSubclassHTMLFromSlug(html, value, this);

                    subclasses.push({
                        // псевдо-id: источник + значение
                        id: `${uuid}#${value}`,
                        parentId: uuid,
                        value,
                        label,
                        name: label,
                        html
                    });
                }
                continue;
            }

            // ---- 2.2.2. choices через filter (item:tag:...) → ищем реальные элементы ----
            const tagBased = await resolveTagBasedChoices(ruleChoices, uuid, this);
            if (tagBased.length) {
                subclasses.push(...tagBased);
                continue;
            }

            // ---- 2.2.3. Нет явного списка choices → используем сам источник как один вариант ----
            const labelSolo =
                doc.name ??
                choice.label ??
                choice.name ??
                game.i18n.localize("PF2ECM.subclass.unnamedChoice");

            let htmlSolo = choice.html ?? "";
            if (!htmlSolo) {
                try {
                    if (typeof this._enrichHTML === "function") {
                        htmlSolo = await this._enrichHTML(`@UUID[${doc.uuid}]{${doc.name}}`);
                    }
                } catch (e) {
                    console.warn(
                        "PF2ECM | subclass-step: enrichHTML failed for source ChoiceSet",
                        doc.uuid,
                        e
                    );
                }
            }

            subclasses.push({
                id: uuid,
                parentId: uuid,
                value: null,
                label: labelSolo,
                name: labelSolo,
                html: htmlSolo
            });
        }

        const selectedSubclassId = this.draft?.subclassId ?? null;

        ctx.classes = classes;
        ctx.currentClass = currentClass;
        ctx.subclasses = subclasses;
        ctx.selectedSubclassId = selectedSubclassId;

        console.debug("PF2ECM | subclass-step context:", {
            step: this.currentStepId,
            classId,
            className: currentClass.name,
            subclassesCount: subclasses.length,
            subclassLabels: subclasses.map((s) => s.label)
        });

        return ctx;
    };

    // -------------------------------------------------------------------------
    // 3) Обработчик клика по подклассу
    // -------------------------------------------------------------------------

    appClass._onSelectSubclass = function (event, target) {
        event.preventDefault();
        const card = target.closest("[data-subclass-id]");
        if (!card) return;
        const subclassId = card.dataset.subclassId;
        if (!subclassId) return;

        this.draft.subclassId = subclassId;
        this.render();
    };

    // -------------------------------------------------------------------------
    // 4) Регистрируем action selectSubclass
    // -------------------------------------------------------------------------

    const defaults = appClass.DEFAULT_OPTIONS || {};
    const actions = (defaults.actions = defaults.actions || {});
    if (!actions.selectSubclass) {
        actions.selectSubclass = appClass._onSelectSubclass;
    }
    appClass.DEFAULT_OPTIONS = defaults;
});
