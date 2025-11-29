"use strict";

/**
 * Шаг классов для PF2ECharacterMasterApp.
 * Этот файл расширяет (или переопределяет) методы класса, объявленного в character-master.js.
 *
 * Он использует вспомогательные методы, уже определённые в основном файле:
 *  - this._abilityLabel
 *  - this._skillLabel
 *  - this._traitLabel
 *  - this._rankLabel
 *  - this._enrichHTML
 *
 * и структуру данных, к которой уже привязан шаблон character-master.html.
 */
(function registerClassStep(appClass) {
    if (!appClass) return;

    /**
     * Догружает подробности по классу:
     *  - описание (enrichHTML)
     *  - список фич (features)
     *  - ключевые выборы 1-го уровня (keyChoices)
     *  - прогрессию по уровням (progression)
     *
     * @param {object} cls — объект класса из _loadClasses
     */
    appClass.prototype._ensureClassDetails = async function (cls) {
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
    };

    /**
     * Загружает список классов из компендиев PF2e.
     * Результат кэшируется в this._cache.classes.
     *
     * Структура возвращаемого объекта полностью согласована с шаблоном:
     *  - hp, keyAbilities, skills, traits
     *  - proficiencies (perception, savingThrows, attacks, defenses, classDC)
     *  - spellcasting (hasSpellcasting, tradition, castingType)
     *  - descriptionRaw, featureRefs, description, features, keyChoices, progression
     */
    appClass.prototype._loadClasses = async function () {
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

                // ---------- HP за уровень ----------
                const hp =
                    sys.hp?.perLevel ??
                    sys.hp?.value ??
                    sys.hp ??
                    null;

                // ---------- Ключевые характеристики ----------
                let keyAbilities = [];
                const ka = sys.keyAbility ?? {};
                const kaVal = ka.value ?? ka.selected ?? ka;
                if (Array.isArray(kaVal)) {
                    keyAbilities = kaVal.map((ab) => this._abilityLabel(ab));
                } else if (kaVal) {
                    keyAbilities = [this._abilityLabel(kaVal)];
                }

                // ---------- Навыки ----------
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

                // ---------- Трейты класса ----------
                const traitsRaw = sys.traits ?? {};
                const traitsValues = traitsRaw.value ?? [];
                const traits = Array.isArray(traitsValues)
                    ? traitsValues.map((t) => this._traitLabel(t))
                    : [];

                // ---------- Владения / профiciencies ----------
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

                    // Традиция: arcane/divine/primal/occult
                    if (tradVal) {
                        const tradCfg = CONFIG?.PF2E?.magicTraditions ?? {};
                        const locKey = tradCfg[tradVal];
                        traditionLabel =
                            typeof locKey === "string"
                                ? game.i18n.localize(locKey)
                                : this._traitLabel(tradVal);
                    }

                    // Тип магии: prepared/spontaneous/focus/innate
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

                // Если spellcasting пустой, но класс явно кастер — пробуем угадать по имени
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

                // ---------- Описание ----------
                const descriptionRaw = sys.description?.value ?? "";

                // ---------- Фичи класса (class features) ----------
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

                // Если в системных данных фич нет, но есть вложенные предметы — используем их
                if (!featureRefs.length && doc.items?.size) {
                    for (const item of doc.items.contents) {
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
    };
})(PF2ECharacterMasterApp);
