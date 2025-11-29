"use strict";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Мастер создания персонажа PF2e
 */
class PF2ECharacterMasterApp extends HandlebarsApplicationMixin(ApplicationV2) {
    /** Порядок шагов мастера */
    static STEP_IDS = ["ancestry", "heritage", "background", "class", "abilities"];

    /** Опции приложения */
    static DEFAULT_OPTIONS = {
        ...super.DEFAULT_OPTIONS,

        id: "pf2e-character-master",
        classes: ["pf2e-character-master", "sheet"],
        tag: "div",

        position: {
            width: 1100,
            height: 650
        },

        window: {
            title: "PF2ECM.app.title",
            icon: "fa-solid fa-hat-wizard",
            resizable: true
        },

        actions: {
            selectStep: PF2ECharacterMasterApp._onSelectStep,
            selectAncestry: PF2ECharacterMasterApp._onSelectAncestry,
            selectHeritage: PF2ECharacterMasterApp._onSelectHeritage,
            selectBackground: PF2ECharacterMasterApp._onSelectBackground,
            selectClass: PF2ECharacterMasterApp._onSelectClass,
            goPrevStep: PF2ECharacterMasterApp._onGoPrevStep,
            goNextStep: PF2ECharacterMasterApp._onGoNextStep,
            closeMaster: PF2ECharacterMasterApp._onCloseMaster
        }
    };

    /** Основной шаблон (все шаги внутри одного файла) */
    static PARTS = {
        main: {
            template: "modules/pf2e-character-master/templates/character-master.html",
            scrollable: []
        }
    };

    constructor(options = {}) {
        super(options);

        /** @type {ActorPF2e|null} */
        this.actor = options.actor ?? null;

        /** @type {"ancestry"|"heritage"|"background"|"class"|"abilities"} */
        this.currentStepId = "ancestry";

        /** Выборы пользователя */
        this.draft = {
            ancestryId: null,
            ancestryName: null,
            ancestrySlug: null,
            heritageId: null,
            backgroundId: null,
            classId: null
        };

        /** Кеш списков из компендиев */
        this._cache = {
            ancestries: null,
            heritages: null,
            backgrounds: null,
            classes: null
        };
    }

    // ---------------------------------------------------------------------------
    // ВСПОМОГАТЕЛЬНЫЕ ШТУКИ
    // ---------------------------------------------------------------------------

    _getTextEditorClass() {
        // Поддержка V12/V13 (новый TextEditor в foundry.applications.ux)
        return (
            foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor
        );
    }

    async _enrichHTML(raw) {
        const TextEditorClass = this._getTextEditorClass();
        return await TextEditorClass.enrichHTML(raw ?? "", { async: true });
    }

    // ---------------------------------------------------------------------------
    // ПОДГОТОВКА ДАННЫХ ДЛЯ ШАБЛОНА
    // ---------------------------------------------------------------------------

    async _prepareContext() {
        const stepOrder = this.constructor.STEP_IDS;

        const steps = stepOrder.map((id) => ({
            id,
            label: game.i18n.localize(`PF2ECM.step.${id}`)
        }));

        // ---------- Родословные ----------
        const ancestries = await this._loadAncestries();
        const hasSelectedAncestry = !!this.draft.ancestryId;
        const selectedAncestry =
            ancestries.find((a) => a.id === this.draft.ancestryId) ?? null;

        if (this.currentStepId === "ancestry" && selectedAncestry) {
            await this._ensureAncestryDetails(selectedAncestry);
        }

        // ---------- Наследия ----------
        let heritages = [];
        let selectedHeritage = null;

        if (this.currentStepId === "heritage" && hasSelectedAncestry) {
            heritages = await this._loadHeritages(this.draft.ancestrySlug);
            selectedHeritage =
                heritages.find((h) => h.id === this.draft.heritageId) ?? null;
            if (selectedHeritage) {
                await this._ensureHeritageDetails(selectedHeritage);
            }
        }

        // ---------- Предыстории ----------
        let backgrounds = [];
        let selectedBackground = null;

        if (this.currentStepId === "background") {
            backgrounds = await this._loadBackgrounds();
            selectedBackground =
                backgrounds.find((b) => b.id === this.draft.backgroundId) ?? null;
            await this._ensureBackgroundDetails(selectedBackground);
        }

        // ---------- Классы ----------
        let classes = [];
        let selectedClass = null;

        if (this.currentStepId === "class") {
            classes = await this._loadClasses();
            selectedClass = classes.find((c) => c.id === this.draft.classId) ?? null;
            await this._ensureClassDetails(selectedClass);
        }

        // ---------- Навигация ----------
        const stepIndex = Math.max(stepOrder.indexOf(this.currentStepId), 0);
        const isFirst = stepIndex === 0;
        const isLast = stepIndex === stepOrder.length - 1;

        const canGoBack = !isFirst;
        let canGoNext = !isLast;

        if (this.currentStepId === "ancestry" && !this.draft.ancestryId) {
            canGoNext = false;
        }

        const stepCounterLabel = game.i18n.format("PF2ECM.nav.stepCounter", {
            current: stepIndex + 1,
            total: stepOrder.length
        });

        const nav = {
            canGoBack,
            canGoNext,
            stepCounterLabel
        };

        // ---------- Сводка по атрибутам (для шага abilities) ----------
        const abilitySummary = [];
        const abilitiesCfg = CONFIG?.PF2E?.abilities ?? {};
        const actorAbilities = this.actor?.system?.abilities ?? {};
        const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"];

        for (const key of abilityKeys) {
            const locKey = abilitiesCfg[key];
            const label =
                typeof locKey === "string"
                    ? game.i18n.localize(locKey)
                    : key.toUpperCase();

            const data = actorAbilities[key] ?? {};
            const mod =
                typeof data.mod === "number"
                    ? data.mod
                    : 0;
            const score =
                typeof data.value === "number"
                    ? data.value
                    : 10;

            abilitySummary.push({
                key,
                short: key.toUpperCase(),
                label,
                mod,
                score
            });
        }

        return {
            steps,
            currentStepId: this.currentStepId,

            ancestries,
            hasSelectedAncestry,
            heritages,
            backgrounds,
            classes,

            selectedAncestryId: this.draft.ancestryId,
            selectedHeritageId: this.draft.heritageId,
            selectedBackgroundId: this.draft.backgroundId,
            selectedClassId: this.draft.classId,

            currentAncestry: selectedAncestry,
            currentHeritage: selectedHeritage,
            currentBackground: selectedBackground,
            currentClass: selectedClass,

            actorName: this.actor?.name ?? null,
            nav,
            abilitySummary
        };
    }

    // ---------------------------------------------------------------------------
    // ЛОКАЛИЗАЦИЯ КЛЮЧЕЙ / РАНГОВ
    // ---------------------------------------------------------------------------

    _sizeLabel(sizeKey) {
        if (!sizeKey) return "";

        const sizes = CONFIG?.PF2E?.actorSizes ?? {};
        const str = String(sizeKey);

        if (sizes[str]) {
            return game.i18n.localize(sizes[str]);
        }

        const entry = Object.entries(sizes).find(([, locKey]) => locKey === str);
        if (entry) {
            return game.i18n.localize(entry[1]);
        }

        return game.i18n.localize(str);
    }

    _abilityLabel(key) {
        if (!key) return "";

        let str = String(key);

        if (str === "free") {
            return game.i18n.localize("PF2ECM.ancestry.details.free");
        }

        const abilitiesCfg =
            CONFIG?.PF2E?.abilities ?? CONFIG?.PF2E?.abilitiesShort ?? {};

        if (str.startsWith("PF2E.Ability")) {
            const suffix = str.replace("PF2E.Ability", "");
            const lowerSuffix = suffix.toLowerCase();
            const map = {
                str: "str",
                strength: "str",
                dex: "dex",
                dexterity: "dex",
                con: "con",
                constitution: "con",
                int: "int",
                intelligence: "int",
                wis: "wis",
                wisdom: "wis",
                cha: "cha",
                charisma: "cha"
            };
            const abKey = map[lowerSuffix] ?? lowerSuffix;
            const locKey = abilitiesCfg[abKey];
            if (typeof locKey === "string") {
                return game.i18n.localize(locKey);
            }
            return game.i18n.localize(str);
        }

        const lower = str.toLowerCase();
        const locKey = abilitiesCfg[lower];
        if (typeof locKey === "string") {
            return game.i18n.localize(locKey);
        }

        if (str.startsWith("PF2E.")) {
            return game.i18n.localize(str);
        }

        return str.toUpperCase();
    }

    _languageLabel(key) {
        if (!key) return "";

        const languagesCfg = CONFIG?.PF2E?.languages ?? {};
        let str = String(key);

        if (str.startsWith("PF2E.Actor.Creature.Language.")) {
            const slug = str.split(".").pop()?.toLowerCase() ?? "";
            const locKey = languagesCfg[slug];
            if (typeof locKey === "string") {
                return game.i18n.localize(locKey);
            }
            return game.i18n.localize(str);
        }

        const lower = str.toLowerCase();
        const locKey = languagesCfg[lower];
        if (typeof locKey === "string") {
            return game.i18n.localize(locKey);
        }

        if (str.startsWith("PF2E.")) {
            return game.i18n.localize(str);
        }

        return str;
    }

    _skillLabel(slug) {
        if (!slug) return "";
        const skillsCfg =
            CONFIG?.PF2E?.skills ?? CONFIG?.PF2E?.skillList ?? {};
        const key = String(slug).toLowerCase();
        const entry = skillsCfg[key];

        if (!entry) return String(slug);

        if (typeof entry === "string") {
            return game.i18n.localize(entry);
        }

        if (typeof entry === "object") {
            if (typeof entry.label === "string") {
                if (entry.label.startsWith("PF2E.")) {
                    return game.i18n.localize(entry.label);
                }
                return entry.label;
            }
            if (typeof entry.name === "string") {
                return entry.name;
            }
        }

        return String(slug);
    }

    _traitLabel(slug) {
        if (!slug) return "";

        const str = String(slug).toLowerCase();

        const traitSets = [
            CONFIG?.PF2E?.classTraits,
            CONFIG?.PF2E?.magicTraditions,
            CONFIG?.PF2E?.creatureTraits,
            CONFIG?.PF2E?.generalTraits
        ];

        for (const cfg of traitSets) {
            if (!cfg) continue;
            const locKey = cfg[str];
            if (typeof locKey === "string") {
                return game.i18n.localize(locKey);
            }
        }

        if (str.startsWith("PF2E.")) {
            return game.i18n.localize(str);
        }

        return str;
    }

    /**
     * Локализация ранга владения.
     * Нормализуем к индексу 0–4; если локализация сломана — жёсткий русский fallback.
     */
    _rankLabel(rank) {
        if (rank === null || rank === undefined || rank === "") return "";

        const ranksByNumber = CONFIG?.PF2E?.proficiencyRanks ?? {};
        const levelsCfg = CONFIG?.PF2E?.proficiencyLevels ?? {};

        let index = null;

        // 1) Число
        const num = Number(rank);
        if (!Number.isNaN(num) && num >= 0 && num <= 4) index = num;

        // 2) PF2E.ProficiencyRankX
        if (index === null && typeof rank === "string") {
            const m = rank.match(/ProficiencyRank(\d)/);
            if (m) index = Number(m[1]);
        }

        // 3) Строки / ключи с суффиксом Untrained/Trained/...
        if (index === null && typeof rank === "string") {
            const str = rank.toLowerCase();
            const mapSuffix = {
                untrained: 0,
                trained: 1,
                expert: 2,
                master: 3,
                legendary: 4
            };

            for (const [suffix, idx] of Object.entries(mapSuffix)) {
                if (str === suffix || str.endsWith(suffix)) {
                    index = idx;
                    break;
                }
            }
        }

        if (index !== null) {
            const keysToTry = [];

            if (typeof ranksByNumber[index] === "string") {
                keysToTry.push(ranksByNumber[index]);
            }

            const slugByIdx = ["untrained", "trained", "expert", "master", "legendary"][index];
            if (slugByIdx && typeof levelsCfg[slugByIdx] === "string") {
                keysToTry.push(levelsCfg[slugByIdx]);
            }

            keysToTry.push(`PF2E.ProficiencyRank${index}`);

            const alt = [
                "PF2E.ProficiencyUntrained",
                "PF2E.ProficiencyTrained",
                "PF2E.ProficiencyExpert",
                "PF2E.ProficiencyMaster",
                "PF2E.ProficiencyLegendary"
            ][index];
            if (alt) keysToTry.push(alt);

            for (const key of keysToTry) {
                if (!key) continue;
                const localized = game.i18n.localize(key);
                if (localized && localized !== key) return localized;
            }

            const ru = [
                "Нетренированный",
                "Обучен",
                "Эксперт",
                "Мастер",
                "Легендарный"
            ];
            return ru[index] ?? String(rank);
        }

        if (typeof rank === "string" && rank.startsWith("PF2E.")) {
            const localized = game.i18n.localize(rank);
            if (localized && localized !== rank) return localized;
        }

        return String(rank);
    }

    // ---------------------------------------------------------------------------
    // РАЗБОР ПОЛЕЙ СИСТЕМЫ PF2E
    // ---------------------------------------------------------------------------

    _extractAncestryBoosts(sys) {
        const result = [];
        const raw = sys.boosts ?? {};
        const slots = Array.isArray(raw) ? raw : Object.values(raw);

        for (const slot of slots) {
            if (!slot) continue;

            const value = slot.value;
            const selected = slot.selected ?? null;

            if (selected) {
                result.push(this._abilityLabel(selected));
                continue;
            }

            if (Array.isArray(value) && value.length) {
                if (value.includes("free") || value.length > 1) {
                    result.push(this._abilityLabel("free"));
                } else {
                    result.push(this._abilityLabel(value[0]));
                }
            }
        }

        return result;
    }

    _extractBoostSlots(sysBoosts) {
        const boosts = [];
        const raw = sysBoosts ?? {};
        const slots = Array.isArray(raw) ? raw : Object.values(raw);

        for (const slot of slots) {
            if (!slot) continue;

            const value = slot.value ?? [];
            const selected = slot.selected ?? null;

            let label = "";

            if (selected) {
                label = this._abilityLabel(selected);
            } else if (Array.isArray(value) && value.length) {
                const hasFree = value.includes("free");

                if (hasFree || value.length > 3) {
                    label = this._abilityLabel("free");
                } else if (value.length === 1) {
                    label = this._abilityLabel(value[0]);
                } else {
                    const parts = value.map((ab) => this._abilityLabel(ab));
                    label = parts.join(" / ");
                }
            }

            if (label) boosts.push(label);
        }

        return boosts;
    }

    _extractFlaws(sys) {
        const result = [];
        const raw = sys.flaws ?? {};

        if (Array.isArray(raw.value)) {
            for (const ab of raw.value) {
                result.push(this._abilityLabel(ab));
            }
            return result;
        }

        const slots = Array.isArray(raw) ? raw : Object.values(raw);
        for (const slot of slots) {
            if (!slot) continue;

            const selected = slot.selected ?? null;
            const value = slot.value;
            let ab = selected;

            if (!ab && Array.isArray(value) && value.length === 1) {
                ab = value[0];
            }

            if (ab) result.push(this._abilityLabel(ab));
        }

        return result;
    }

    _extractTrainedSkills(sys) {
        const trained = sys.trainedSkills ?? {};
        const result = [];

        const fixed = trained.value ?? trained.skills ?? [];
        if (Array.isArray(fixed)) {
            for (const slug of fixed) {
                result.push(this._skillLabel(slug));
            }
        }

        const lore = trained.lore ?? trained.loreSkill ?? null;
        if (lore) {
            const loreName = lore.label ?? lore.name ?? lore.value;
            if (loreName) {
                result.push(
                    game.i18n.format("PF2ECM.background.details.lore", {
                        lore: loreName
                    })
                );
            }
        }

        const additional = trained.additional ?? trained.any ?? null;
        if (additional) {
            const n =
                typeof additional === "number"
                    ? additional
                    : Number(additional) || 1;
            result.push(
                game.i18n.format("PF2ECM.background.details.additionalSkill", {
                    count: n
                })
            );
        }

        return result;
    }

    // ---------------------------------------------------------------------------
    // ДОГРУЗКА ПОДРОБНОСТЕЙ
    // ---------------------------------------------------------------------------

    async _ensureBackgroundDetails(background) {
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
    }

    async _ensureAncestryDetails(ancestry) {
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
    }

    async _ensureHeritageDetails(heritage) {
        if (!heritage || heritage._detailsReady) return;

        const descriptionRaw = heritage.descriptionRaw ?? "";
        const description = await this._enrichHTML(descriptionRaw);

        heritage.description = description;
        heritage._detailsReady = true;
    }

    async _ensureClassDetails(cls) {
        if (!cls || cls._detailsReady) return;

        const descriptionRaw = cls.descriptionRaw ?? "";
        const featureRefs = cls.featureRefs ?? [];

        const description = await this._enrichHTML(descriptionRaw);

        const features = [];
        const keyChoices = [];
        const progressionMap = new Map();

        for (const ref of featureRefs) {
            const uuid = ref.uuid;
            const name = ref.name;
            const level = ref.level ?? 1;
            if (!uuid || !name) continue;

            const html = await this._enrichHTML(`@UUID[${uuid}]{${name}}`);
            const feature = { id: uuid, level, html };
            features.push(feature);

            if (level === 1) keyChoices.push(feature);

            if (!progressionMap.has(level)) progressionMap.set(level, []);
            progressionMap.get(level).push(feature);
        }

        const progression = Array.from(progressionMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([level, feats]) => ({
                level,
                features: feats
            }));

        cls.description = description;
        cls.features = features;
        cls.keyChoices = keyChoices;
        cls.progression = progression;
        cls._detailsReady = true;
    }

    // ---------------------------------------------------------------------------
    // ЗАГРУЗКА ИЗ КОМПЕНДИЕВ
    // ---------------------------------------------------------------------------

    async _loadAncestries() {
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

                const hp = sys.hp ?? null;

                let speed = null;
                if (typeof sys.speed === "number") {
                    speed = sys.speed;
                } else if (sys.speed && typeof sys.speed.value !== "undefined") {
                    speed = sys.speed.value;
                }

                const sizeKey = sys.size ?? null;
                const sizeLabel = this._sizeLabel(sizeKey);

                const boosts = this._extractAncestryBoosts(sys);
                const flaws = this._extractFlaws(sys);

                const langsRaw = sys.languages?.value ?? sys.languages ?? [];
                const languages = Array.isArray(langsRaw)
                    ? langsRaw.map((k) => this._languageLabel(k))
                    : [];

                const additionalLanguages =
                    sys.additionalLanguages?.count ??
                    sys.additionalLanguages?.value ??
                    sys.additionalLanguages ??
                    0;

                const descriptionRaw = sys.description?.value ?? "";

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

                if (!featureRefs.length && doc.items?.size) {
                    const embedded = doc.items.contents;
                    for (const item of embedded) {
                        featureRefs.push({ uuid: item.uuid, name: item.name });
                    }
                }

                ancestries.push({
                    id: doc.id,
                    name: doc.name,
                    img: doc.img ?? null,
                    slug: sys.slug ?? null,
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
    }

    async _loadHeritages(ancestrySlug) {
        if (!this._cache.heritages) {
            const pack =
                game.packs.get("pf2e.heritages") ||
                game.packs.get("pf2e.heritages-core") ||
                game.packs.get("pf2e.heritages-db");

            if (!pack) {
                console.warn("PF2E Character Master | Компендий с наследиями не найден.");
                this._cache.heritages = [];
            } else {
                try {
                    const docs = await pack.getDocuments();
                    const heritages = [];

                    for (const doc of docs) {
                        const sys = doc.system ?? {};
                        const anc = sys.ancestry ?? {};
                        const slug = anc.slug ?? null;
                        const ancName = anc.name ?? null;

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
                    console.error("PF2E Character Master | Ошибка при загрузке наследий:", err);
                    this._cache.heritages = [];
                }
            }
        }

        if (!ancestrySlug) return this._cache.heritages;

        return this._cache.heritages.filter(
            (h) => !h.ancestrySlug || h.ancestrySlug === ancestrySlug
        );
    }

    async _loadBackgrounds() {
        if (this._cache.backgrounds) return this._cache.backgrounds;

        const pack =
            game.packs.get("pf2e.backgrounds") ||
            game.packs.get("pf2e.backgrounds-srd") ||
            game.packs.get("pf2e.backgrounds-db");

        if (!pack) {
            console.warn("PF2E Character Master | Компендий с предысториями не найден.");
            this._cache.backgrounds = [];
            return this._cache.backgrounds;
        }

        try {
            const docs = await pack.getDocuments();
            const backgrounds = [];

            for (const doc of docs) {
                const sys = doc.system ?? {};

                const boosts = this._extractBoostSlots(sys.boosts);
                const skills = this._extractTrainedSkills(sys);

                const descriptionRaw = sys.description?.value ?? "";

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
            console.error("PF2E Character Master | Ошибка при загрузке предысторий:", err);
            this._cache.backgrounds = [];
            return this._cache.backgrounds;
        }
    }

    async _loadClasses() {
        if (this._cache.classes) return this._cache.classes;

        const pack =
            game.packs.get("pf2e.classes") ||
            game.packs.get("pf2e.classes-srd") ||
            game.packs.get("pf2e.classes-db");

        if (!pack) {
            console.warn("PF2E Character Master | Компендий с классами не найден.");
            this._cache.classes = [];
            return this._cache.classes;
        }

        try {
            const docs = await pack.getDocuments();
            const classes = [];

            for (const doc of docs) {
                const sys = doc.system ?? {};

                const hp =
                    sys.hp?.perLevel ??
                    sys.hp?.value ??
                    sys.hp ??
                    null;

                let keyAbilities = [];
                const ka = sys.keyAbility ?? {};
                const kaVal = ka.value ?? ka.selected ?? ka;
                if (Array.isArray(kaVal)) {
                    keyAbilities = kaVal.map((ab) => this._abilityLabel(ab));
                } else if (kaVal) {
                    keyAbilities = [this._abilityLabel(kaVal)];
                }

                const skills = [];
                const trained = sys.trainedSkills ?? sys.skills ?? {};
                const fixedSkills = trained.value ?? trained.skills ?? [];

                if (Array.isArray(fixedSkills)) {
                    for (const slug of fixedSkills) {
                        skills.push(this._skillLabel(slug));
                    }
                }

                const additional = trained.additional ?? trained.any ?? null;
                if (additional) {
                    const n =
                        typeof additional === "number"
                            ? additional
                            : Number(additional) || 1;
                    skills.push(
                        game.i18n.format("PF2ECM.background.details.additionalSkill", {
                            count: n
                        })
                    );
                }

                const traitsRaw = sys.traits ?? {};
                const traitsValues = traitsRaw.value ?? [];
                const traits = Array.isArray(traitsValues)
                    ? traitsValues.map((t) => this._traitLabel(t))
                    : [];

                const perceptionRank = sys.perception?.value ?? sys.perception ?? null;

                const savesRaw = sys.savingThrows ?? {};
                const fortRank = savesRaw.fortitude?.value ?? savesRaw.fortitude ?? null;
                const refRank = savesRaw.reflex?.value ?? savesRaw.reflex ?? null;
                const willRank = savesRaw.will?.value ?? savesRaw.will ?? null;

                const attacksRaw = sys.attacks ?? {};
                const defensesRaw = sys.defenses ?? {};

                const classDCRank = sys.classDC?.value ?? sys.classDC ?? null;

                const proficiencies = {
                    perception: this._rankLabel(perceptionRank),
                    savingThrows: {
                        fortitude: this._rankLabel(fortRank),
                        reflex: this._rankLabel(refRank),
                        will: this._rankLabel(willRank)
                    },
                    attacks: {
                        simple: this._rankLabel(attacksRaw.simple?.value ?? attacksRaw.simple),
                        martial: this._rankLabel(attacksRaw.martial?.value ?? attacksRaw.martial),
                        advanced: this._rankLabel(attacksRaw.advanced?.value ?? attacksRaw.advanced),
                        unarmed: this._rankLabel(attacksRaw.unarmed?.value ?? attacksRaw.unarmed)
                    },
                    defenses: {
                        unarmored: this._rankLabel(defensesRaw.unarmored?.value ?? defensesRaw.unarmored),
                        light: this._rankLabel(defensesRaw.light?.value ?? defensesRaw.light),
                        medium: this._rankLabel(defensesRaw.medium?.value ?? defensesRaw.medium),
                        heavy: this._rankLabel(defensesRaw.heavy?.value ?? defensesRaw.heavy)
                    },
                    classDC: this._rankLabel(classDCRank)
                };

                // ---------- Магия и заклинания ----------
                let hasSpellcasting = false;
                let traditionLabel = "";
                let castingTypeLabel = "";

                const sc = sys.spellcasting ?? null;
                if (sc) {
                    const tradVal = sc.tradition?.value ?? sc.tradition ?? null;
                    const castingTypeRaw =
                        sc.spellcastingType?.value ??
                        sc.castingType?.value ??
                        sc.castingType ??
                        null;
                    const progVal = sc.progression ?? null;
                    const dcVal =
                        sc.dc?.value ??
                        sc.proficiency?.value ??
                        sc.proficiency ??
                        null;

                    hasSpellcasting = !!(tradVal || castingTypeRaw || progVal || dcVal);

                    if (tradVal) {
                        const tradCfg = CONFIG?.PF2E?.magicTraditions ?? {};
                        const locKey = tradCfg[tradVal];
                        traditionLabel =
                            typeof locKey === "string"
                                ? game.i18n.localize(locKey)
                                : this._traitLabel(tradVal);
                    }

                    if (castingTypeRaw) {
                        const sTypes = CONFIG?.PF2E?.spellcastingTypes ?? {};
                        const locKey = sTypes[castingTypeRaw];
                        if (typeof locKey === "string") {
                            castingTypeLabel = game.i18n.localize(locKey);
                        } else {
                            const fallbackType = {
                                prepared: "Подготавливаемая",
                                spontaneous: "Спонтанная",
                                focus: "Фокусная",
                                innate: "Врожденная"
                            };
                            castingTypeLabel = fallbackType[castingTypeRaw] ?? String(castingTypeRaw);
                        }
                    }
                }

                // Если spellcasting пустой, но класс явно кастер — пытаемся угадать
                if (!hasSpellcasting) {
                    const nameLower = (doc.name ?? "").toLowerCase();

                    const casterMap = {
                        "жрец": { trad: "divine", type: "prepared" },
                        "cleric": { trad: "divine", type: "prepared" },

                        "волшебник": { trad: "arcane", type: "prepared" },
                        "wizard": { trad: "arcane", type: "prepared" },

                        "чародей": { trad: "arcane", type: "spontaneous" },
                        "sorcerer": { trad: "arcane", type: "spontaneous" },

                        "друид": { trad: "primal", type: "prepared" },
                        "druid": { trad: "primal", type: "prepared" },

                        "бард": { trad: "occult", type: "spontaneous" },
                        "bard": { trad: "occult", type: "spontaneous" },

                        "ведьма": { trad: "occult", type: "prepared" },
                        "witch": { trad: "occult", type: "prepared" },

                        "оракул": { trad: "divine", type: "spontaneous" },
                        "oracle": { trad: "divine", type: "spontaneous" },

                        "призыватель": { trad: "arcane", type: "spontaneous" },
                        "summoner": { trad: "arcane", type: "spontaneous" },

                        "экстрасенс": { trad: "occult", type: "spontaneous" },
                        "psychic": { trad: "occult", type: "spontaneous" }
                    };

                    let guessed = null;
                    for (const [key, val] of Object.entries(casterMap)) {
                        if (nameLower.includes(key)) {
                            guessed = val;
                            break;
                        }
                    }

                    if (guessed) {
                        hasSpellcasting = true;

                        const tradCfg = CONFIG?.PF2E?.magicTraditions ?? {};
                        const locKey = tradCfg[guessed.trad];
                        traditionLabel =
                            typeof locKey === "string"
                                ? game.i18n.localize(locKey)
                                : this._traitLabel(guessed.trad);

                        const sTypes = CONFIG?.PF2E?.spellcastingTypes ?? {};
                        const typeKey = sTypes[guessed.type];
                        if (typeof typeKey === "string") {
                            castingTypeLabel = game.i18n.localize(typeKey);
                        } else {
                            const fallbackType = {
                                prepared: "Подготавливаемая",
                                spontaneous: "Спонтанная",
                                focus: "Фокусная",
                                innate: "Врожденная"
                            };
                            castingTypeLabel =
                                fallbackType[guessed.type] ?? String(guessed.type);
                        }
                    }
                }

                const spellcasting = {
                    hasSpellcasting,
                    tradition: traditionLabel,
                    castingType: castingTypeLabel
                };

                const descriptionRaw = sys.description?.value ?? "";

                const featureRefs = [];
                const sysItemsRaw = sys.items ?? [];
                const sysItems = Array.isArray(sysItemsRaw)
                    ? sysItemsRaw
                    : Object.values(sysItemsRaw);

                for (const entry of sysItems) {
                    if (!entry) continue;
                    const uuid = entry.uuid ?? entry.item ?? entry.id;
                    const name = entry.name ?? entry.label ?? entry.slug;
                    let level =
                        entry.level ??
                        entry.system?.level?.value ??
                        entry.data?.level?.value ??
                        1;
                    level = Number(level) || 1;

                    if (!uuid || !name) continue;
                    featureRefs.push({ uuid, name, level });
                }

                if (!featureRefs.length && doc.items?.size) {
                    const embedded = doc.items.contents;
                    for (const item of embedded) {
                        let level =
                            item.system?.level?.value ??
                            item.data?.data?.level?.value ??
                            1;
                        level = Number(level) || 1;
                        featureRefs.push({ uuid: item.uuid, name: item.name, level });
                    }
                }

                classes.push({
                    id: doc.id,
                    name: doc.name,
                    img: doc.img ?? null,
                    hp,
                    keyAbilities,
                    skills,
                    traits,
                    proficiencies,
                    spellcasting,
                    descriptionRaw,
                    featureRefs,
                    description: "",
                    features: [],
                    keyChoices: [],
                    progression: [],
                    _detailsReady: false
                });
            }

            this._cache.classes = classes;
            return classes;
        } catch (err) {
            console.error("PF2E Character Master | Ошибка при загрузке классов:", err);
            this._cache.classes = [];
            return this._cache.classes;
        }
    }

    // ---------------------------------------------------------------------------
    // ОБРАБОТЧИКИ КНОПОК
    // ---------------------------------------------------------------------------

    static _onSelectStep(event, target) {
        event.preventDefault();
        const li = target.closest("[data-step-id]");
        if (!li) return;

        const stepId = li.dataset.stepId;
        if (!stepId || stepId === this.currentStepId) return;

        this.currentStepId = stepId;
        this.render();
    }

    static _onSelectAncestry(event, target) {
        event.preventDefault();
        const card = target.closest("[data-ancestry-id]");
        if (!card) return;

        const ancestryId = card.dataset.ancestryId;
        const ancestryName = card.dataset.ancestryName || null;
        const ancestrySlug = card.dataset.ancestrySlug || null;
        if (!ancestryId) return;

        this.draft.ancestryId = ancestryId;
        this.draft.ancestryName = ancestryName;
        this.draft.ancestrySlug = ancestrySlug;
        this.draft.heritageId = null;
        this.render();
    }

    static _onSelectHeritage(event, target) {
        event.preventDefault();
        const card = target.closest("[data-heritage-id]");
        if (!card) return;

        const heritageId = card.dataset.heritageId;
        if (!heritageId) return;

        this.draft.heritageId = heritageId;
        this.render();
    }

    static _onSelectBackground(event, target) {
        event.preventDefault();
        const card = target.closest("[data-background-id]");
        if (!card) return;

        const backgroundId = card.dataset.backgroundId;
        if (!backgroundId) return;

        this.draft.backgroundId = backgroundId;
        this.render();
    }

    static _onSelectClass(event, target) {
        event.preventDefault();
        const card = target.closest("[data-class-id]");
        if (!card) return;

        const classId = card.dataset.classId;
        if (!classId) return;

        this.draft.classId = classId;
        this.render();
    }

    static _onGoPrevStep(event, target) {
        event.preventDefault();

        const order = this.constructor.STEP_IDS;
        const idx = order.indexOf(this.currentStepId);
        if (idx <= 0) return;

        this.currentStepId = order[idx - 1];
        this.render();
    }

    static _onGoNextStep(event, target) {
        event.preventDefault();

        const order = this.constructor.STEP_IDS;
        const idx = order.indexOf(this.currentStepId);
        if (idx === -1 || idx >= order.length - 1) return;

        if (this.currentStepId === "ancestry" && !this.draft.ancestryId) return;

        this.currentStepId = order[idx + 1];
        this.render();
    }

    static _onCloseMaster(event, target) {
        event.preventDefault();
        this.close();
    }
}

// Экспортируем в глобальную область, чтобы можно было вызывать из макросов/других скриптов
window.PF2ECharacterMasterApp = PF2ECharacterMasterApp;
