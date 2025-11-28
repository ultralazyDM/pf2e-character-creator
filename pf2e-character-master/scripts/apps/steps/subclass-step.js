"use strict";

/**
 * Шаг «Подкласс / ключевые выборы класса» для PF2ECharacterMasterApp.
 *
 * Логика:
 *  - Ищем все фичи 1-го уровня с правилом ChoiceSet.
 *  - Каждая фича = группа (муза, доктрина, орден и т.п.).
 *  - Каждая опция ChoiceSet = вариант внутри группы.
 *  - В контекст шаблона передаём:
 *      ctx.subclassGroups      — [{ id, name, options:[{id,label,html,...}] }]
 *      ctx.subclassSelections  — { [groupId]: optionId }
 *      ctx.subclassHasGroups   — есть ли вообще группы
 *      ctx.subclassHasSelection— есть ли выбраный вариант
 *      ctx.subclassStepLabel   — красивое имя шага для конкретного класса
 *      ctx.lastSubclassOptionId— последний выбранный option (для правой панели)
 */

(function registerSubclassStep(appClass) {
    if (!appClass) return;

    // Кэш фич классов
    let cachedClassFeatures = null;

    async function getClassFeatureDocs() {
        if (cachedClassFeatures) return cachedClassFeatures;

        const pack =
            game.packs.get("pf2e.classfeatures") ||
            game.packs.get("pf2e.classfeatures-srd") ||
            game.packs.get("pf2e.classfeatures-db");

        if (!pack) {
            console.warn("PF2ECM | subclass-step: classfeatures pack missing.");
            cachedClassFeatures = [];
            return cachedClassFeatures;
        }

        try {
            cachedClassFeatures = await pack.getDocuments();
        } catch (err) {
            console.error("PF2ECM | subclass-step: failed to load classfeatures", err);
            cachedClassFeatures = [];
        }

        return cachedClassFeatures;
    }

    /** Обогащённое HTML-описание документа */
    async function getDocHTML(app, doc) {
        const sys = doc.system ?? {};
        const raw =
            (sys.description?.value && typeof sys.description.value === "string" && sys.description.value) ||
            (typeof sys.description === "string" ? sys.description : "") ||
            "";

        if (!raw) return "";

        try {
            return await app._enrichHTML(raw);
        } catch {
            return raw;
        }
    }

    /** Описание по slug (ищем в compendium classfeatures) */
    async function enrichFromSlug(app, slug) {
        if (!slug) return "";
        const docs = await getClassFeatureDocs();
        if (!docs.length) return "";

        const s = String(slug).trim();
        const doc = docs.find(d => String(d.system?.slug ?? d.slug ?? "").trim() === s);
        if (!doc) return "";

        return await getDocHTML(app, doc);
    }

    /** Раскрываем item:tag фильтры в список опций */
    async function expandTagChoices(app, parentUuid, spec) {
        if (!spec || !spec.filter) return [];

        const filters = Array.isArray(spec.filter) ? spec.filter : [spec.filter];
        const tags = filters
            .map(f => /^item:tag:(.+)$/i.exec(f))
            .filter(Boolean)
            .map(m => m[1]);

        if (!tags.length) return [];

        const docs = await getClassFeatureDocs();
        const results = [];

        for (const doc of docs) {
            const sys = doc.system ?? {};
            const traits = [
                ...(sys.traits?.value ?? []),
                ...(sys.traits?.otherTags ?? []),
                ...(sys.traits?.other ?? [])
            ].map(t => String(t));

            if (!traits.some(t => tags.includes(t))) continue;

            const html = await getDocHTML(app, doc);

            results.push({
                id: doc.uuid,
                parentId: parentUuid,
                value: sys.slug ?? doc.slug ?? "",
                label: doc.name,
                html
            });
        }

        return results;
    }

    async function resolveTagBasedChoices(spec, parentUuid, app) {
        if (!spec) return [];
        return expandTagChoices(app, parentUuid, spec);
    }

    /** Имя шага в зависимости от класса */
    function getSubclassStepLabel(currentClass) {
        const slug = String(
            currentClass?.slug ?? currentClass?.system?.slug ?? ""
        ).toLowerCase();

        const loc = k => {
            const res = game.i18n.localize(k);
            return res === k ? null : res;
        };

        switch (slug) {
            case "bard":
                return loc("PF2ECM.subclass.bardMuse") || "Выбор музы";
            case "druid":
                return loc("PF2ECM.subclass.druidOrder") || "Выбор ордена";
            case "cleric":
                return loc("PF2ECM.subclass.clericDoctrine") || "Выбор доктрины";
            case "champion":
                return loc("PF2ECM.subclass.championCause") || "Путь чемпиона";
            case "oracle":
                return loc("PF2ECM.subclass.oracleMystery") || "Выбор тайны";
            default:
                return loc("PF2ECM.step.subclass") || "Подкласс / ключевые выборы";
        }
    }

    // ----------------------------------------------------------
    // Вставляем шаг "subclass" в список STEP_IDS, если его нет
    // ----------------------------------------------------------
    if (!appClass.STEP_IDS.includes("subclass")) {
        const order = [...appClass.STEP_IDS];
        const idx = order.indexOf("abilities");
        if (idx >= 0) order.splice(idx, 0, "subclass");
        else order.push("subclass");
        appClass.STEP_IDS = order;
    }

    // ----------------------------------------------------------
    // Патчим _prepareContext
    // ----------------------------------------------------------
    const originalPrepare = appClass.prototype._prepareContext;

    appClass.prototype._prepareContext = async function () {
        const ctx = await originalPrepare.call(this);

        // Нас интересует только шаг subclass
        if (this.currentStepId !== "subclass") return ctx;

        // Классы
        let classes = ctx.classes ?? [];
        if (!classes.length && this._loadClasses) {
            try {
                classes = await this._loadClasses();
            } catch {
                classes = [];
            }
        }

        const classId = this.draft?.classId ?? null;
        const currentClass = classes.find(c => c.id === classId) ?? null;

        ctx.currentClass = currentClass;
        ctx.subclassStepLabel = currentClass ? getSubclassStepLabel(currentClass) : null;

        if (!currentClass) {
            ctx.subclassGroups = [];
            ctx.subclassSelections = {};
            ctx.subclassHasGroups = false;
            ctx.subclassHasSelection = false;
            ctx.lastSubclassOptionId = null;
            ctx.subclassNoChoicesMessage =
                game.i18n.localize("PF2ECM.subclass.noChoices") ||
                "У выбранного класса нет ключевых выборов на 1-м уровне.";
            return ctx;
        }

        // Грузим подробности класса (featureRefs и т.п.)
        await this._ensureClassDetails(currentClass);

        const refs = currentClass.featureRefs ?? [];
        const level1 = refs.filter(r => Number(r.level ?? 1) === 1);

        const groups = [];

        for (const ref of level1) {
            const uuid = ref.uuid ?? ref.id;
            if (!uuid) continue;

            let doc = null;
            try {
                doc = await fromUuid(uuid);
            } catch {
                continue;
            }
            if (!doc?.system) continue;

            const rules = Array.isArray(doc.system.rules) ? doc.system.rules : [];
            const choiceRule = rules.find(r =>
                r && (r.key === "ChoiceSet" || r.key === "ChoiceSetRuleElement")
            );
            if (!choiceRule) continue;

            const groupName =
                doc.name ||
                choiceRule.label ||
                "Выбор";

            const group = {
                id: uuid,
                name: groupName,
                options: []
            };

            const spec = choiceRule.choices;

            // Явный список опций
            if (Array.isArray(spec) && spec.length) {
                for (const ch of spec) {
                    const value = ch.value ?? ch.slug ?? ch.id ?? "";
                    if (!value) continue;

                    let label =
                        typeof ch.label === "string"
                            ? game.i18n.localize(ch.label)
                            : (ch.name || value);

                    let html = ch.description ?? "";
                    if (!html) {
                        html = await enrichFromSlug(this, value);
                    } else {
                        try {
                            html = await this._enrichHTML(html);
                        } catch { /* ignore */ }
                    }

                    group.options.push({
                        id: uuid + "#" + value,
                        parentId: uuid,
                        value,
                        label,
                        html
                    });
                }
            }
            // item:tag
            else {
                const tagChoices = await resolveTagBasedChoices(spec, uuid, this);
                if (tagChoices.length) {
                    group.options.push(...tagChoices);
                } else {
                    // одиночный вариант — просто сама фича
                    const html = await getDocHTML(this, doc);
                    group.options.push({
                        id: uuid,
                        parentId: uuid,
                        value: doc.system.slug ?? "",
                        label: doc.name,
                        html
                    });
                }
            }

            if (group.options.length) {
                groups.push(group);
            }
        }

        ctx.subclassGroups = groups;
        ctx.subclassSelections = this.draft.subclassSelections ?? {};
        ctx.lastSubclassOptionId = this.draft.lastSubclassOptionId ?? null;
        ctx.subclassHasGroups = groups.length > 0;
        ctx.subclassHasSelection = !!ctx.lastSubclassOptionId ||
            Object.keys(ctx.subclassSelections).length > 0;

        if (!groups.length) {
            ctx.subclassNoChoicesMessage =
                game.i18n.localize("PF2ECM.subclass.noChoices") ||
                "У выбранного класса нет ключевых выборов на 1-м уровне.";
        }

        return ctx;
    };

    // ----------------------------------------------------------
    // Обработчик клика по варианту подкласса
    // ----------------------------------------------------------
    appClass._onSelectSubclassOption = function (event, target) {
        event.preventDefault();

        const groupId = target.closest("[data-group-id]")?.dataset.groupId;
        const optionId = target.dataset.optionId;

        if (!groupId || !optionId) return;

        if (!this.draft.subclassSelections) this.draft.subclassSelections = {};
        this.draft.subclassSelections[groupId] = optionId;

        // запоминаем последний выбранный вариант для правой панели
        this.draft.lastSubclassOptionId = optionId;

        this.render();
    };

    // Регистрируем action
    const def = appClass.DEFAULT_OPTIONS;
    def.actions ??= {};
    def.actions.selectSubclassOption = appClass._onSelectSubclassOption;

})(PF2ECharacterMasterApp);
