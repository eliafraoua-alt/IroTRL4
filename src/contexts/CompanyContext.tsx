// IRO: Contexte d'entreprise unifié pour l'Onboarding et la propagation d'état
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

export interface CompanyContextType {
  companyName: string;
  siren: string;
  sector: string;
  stage: string;
  country: string;
  isLoaded: boolean;
  setCompany: (data: { companyName: string; siren?: string; sector?: string; stage?: string; country?: string }) => void;
  resetCompany: () => void;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [companyName, setCompanyName] = useState<string>(() => localStorage.getItem('company_name_v7') || '');
  const [siren, setSiren] = useState<string>(() => localStorage.getItem('company_siren_v7') || '');
  const [sector, setSector] = useState<string>(() => localStorage.getItem('company_sector_v7') || '');
  const [stage, setStage] = useState<string>(() => localStorage.getItem('company_stage_v7') || '');
  const [country, setCountry] = useState<string>(() => localStorage.getItem('company_country_v7') || 'France');
  const [isLoaded, setIsLoaded] = useState<boolean>(() => localStorage.getItem('company_is_loaded_v7') === 'true');

  const setCompany = useCallback((data: { companyName: string; siren?: string; sector?: string; stage?: string; country?: string }) => {
    const cleanName = data.companyName.trim();
    setCompanyName(cleanName);
    const s = data.siren?.trim() || '';
    setSiren(s);
    const sec = data.sector?.trim() || '';
    setSector(sec);
    const stg = data.stage?.trim() || '';
    setStage(stg);
    const c = data.country?.trim() || 'France';
    setCountry(c);
    setIsLoaded(true);

    localStorage.setItem('company_name_v7', cleanName);
    localStorage.setItem('company_siren_v7', s);
    localStorage.setItem('company_sector_v7', sec);
    localStorage.setItem('company_stage_v7', stg);
    localStorage.setItem('company_country_v7', c);
    localStorage.setItem('company_is_loaded_v7', 'true');
  }, []);

  const resetCompany = useCallback(() => {
    setCompanyName('');
    setSiren('');
    setSector('');
    setStage('');
    setCountry('France');
    setIsLoaded(false);

    localStorage.removeItem('company_name_v7');
    localStorage.removeItem('company_siren_v7');
    localStorage.removeItem('company_sector_v7');
    localStorage.removeItem('company_stage_v7');
    localStorage.removeItem('company_country_v7');
    localStorage.removeItem('company_is_loaded_v7');
  }, []);

  const value = useMemo(() => ({
    companyName,
    siren,
    sector,
    stage,
    country,
    isLoaded,
    setCompany,
    resetCompany
  }), [companyName, siren, sector, stage, country, isLoaded, setCompany, resetCompany]);

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompanyContext = () => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompanyContext must be used within a CompanyProvider');
  }
  return context;
};
