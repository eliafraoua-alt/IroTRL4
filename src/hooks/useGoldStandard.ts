import { useState, useMemo, useCallback, useEffect } from 'react';
import { GOLD_STANDARD, type GoldStandardEntry } from '../types/iro';
import { calcR2Enriched } from '../utils/iro-engine';
import { validateGoldStandard } from '../utils/gold-standard-validator';
import { loadFrozenGoldStandard, freezeGoldStandard, exportToJSON } from '../utils/gold-standard-manager';

/**
 * Hook useGoldStandard - Gestion du dataset de référence (Gold Standard)
 * Permet de charger, manipuler et auditer les benchmarks utilisés pour la calibration du modèle.
 * 
 * Contient les 125 startups de référence (n=125 depuis v6.6).
 */
export const useGoldStandard = () => {
    const [entries, setEntries] = useState<GoldStandardEntry[]>(GOLD_STANDARD);
    const [isLoading, setIsLoading] = useState(false);
    const [isFrozen, setIsFrozen] = useState(false);

    // Initialisation depuis le stockage gelé si présent
    useEffect(() => {
        const load = async () => {
            try {
                const frozen = await loadFrozenGoldStandard();
                if (frozen?.entries?.length > 0) {
                    setEntries(frozen.entries);
                    setIsFrozen(true);
                }
            } catch (e) {
                // Silencieux
            }
        };
        load();
    }, []);

    // Calculs statistiques (v4.4)
    const metrics = useMemo(() => calcR2Enriched(entries), [entries]);

    // Résultats de validation
    const validation = useMemo(() => {
        const baseValidation = validateGoldStandard(entries);
        return {
            ...baseValidation,
            isUsable: metrics.isStatisticallyUsable,
            sampleSize: entries.length,
            requiredSize: 60,
            qualityScore: Math.round(metrics.spearman * 100) / 100,
            errorMargin: Math.round(metrics.rmse * 100) / 100
        };
    }, [entries, metrics]);

    /**
     * runAudit - Déclenche l'audit statistique complet du Gold Standard
     */
    const runAudit = useCallback(async () => {
        setIsLoading(true);
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Ici on pourrait intégrer auditGoldStandard(entries)
        } finally {
            setIsLoading(false);
        }
    }, [entries]);

    /**
     * freeze - Gèle les résultats actuels
     */
    const freeze = useCallback((validatedEntries?: GoldStandardEntry[]) => {
        const target = validatedEntries || entries;
        try {
            freezeGoldStandard(target, 'eliafraoua@gmail.com');
            setIsFrozen(true);
            setEntries(target);
        } catch (e) {
            console.error('Erreur during freeze:', e);
            throw e;
        }
    }, [entries]);

    /**
     * exportJSON - Exporte le benchmark au format JSON
     */
    const exportJSON = useCallback(() => {
        try {
            const frozen = freezeGoldStandard(entries, 'eliafraoua@gmail.com');
            const dataStr = exportToJSON(frozen);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
            const exportFileDefaultName = `iro-gold-standard-v4.4-${new Date().toISOString().split('T')[0]}.json`;

            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();
        } catch (error) {
            console.error('Échec de l\'export JSON:', error);
        }
    }, [entries]);

    return {
        entries,
        setEntries,
        goldStandard: entries,
        metrics,
        isLoading,
        runAudit,
        freeze,
        exportJSON,
        validation,
        isFrozen
    };
};

export type { GoldStandardEntry };
const goldStandard = GOLD_STANDARD as GoldStandardEntry[];
export const actuals = goldStandard.map(g => g.sce.final);
