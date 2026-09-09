import { CustomSelect } from '@/components/forms';
import { useTranslation } from 'react-i18next';

interface DepreciationSettingsProps {
  depreciationType: 'none' | 'immediate' | 'partial' | null;
  depreciationYears?: number | null;
  depreciationMethod?: 'linear' | 'degressive' | null;
  onChange: (field: string, value: any) => void;
}

export function DepreciationSettings({
  depreciationType,
  depreciationYears,
  depreciationMethod,
  onChange,
}: DepreciationSettingsProps) {
  const { t } = useTranslation('expenses');

  const depreciationTypeOptions = [
    { value: 'none', label: t('depreciation.types.none', 'Keine') },
    { value: 'immediate', label: t('depreciation.types.immediate', 'Sofortabschreibung (GWG < 800€)') },
    { value: 'partial', label: t('depreciation.types.partial', 'Teilabschreibung (Anteilig)') },
  ];

  const depreciationMethodOptions = [
    { value: 'linear', label: t('depreciation.methods.linear', 'Linear') },
    // Must stay 'degressive': both expenses_depreciation_method_check and the
    // Joi update schema reject anything else.
    { value: 'degressive', label: t('depreciation.methods.degressive', 'Declining Balance') },
  ];

  return (
    <div className="space-y-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
      <h3 className="text-sm font-medium text-amber-900 dark:text-amber-100">
        {t('depreciation.title', 'Depreciation (AfA)')}
      </h3>
      
      <div className="space-y-4">
        <CustomSelect
          label={t('depreciation.type', 'Depreciation Type')}
          options={depreciationTypeOptions}
          value={depreciationType || 'none'}
          onChange={(value) => onChange('depreciation_type', value)}
        />

        {depreciationType === 'partial' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('depreciation.years', 'Depreciation Years')}
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={depreciationYears || ''}
                onChange={(e) => onChange('depreciation_years', parseInt(e.target.value) || null)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                placeholder={t('depreciation.yearsPlaceholder', 'Enter number of years')}
              />
            </div>

            <CustomSelect
              label={t('depreciation.method', 'Depreciation Method')}
              options={depreciationMethodOptions}
              value={depreciationMethod || 'linear'}
              onChange={(value) => onChange('depreciation_method', value)}
            />
          </>
        )}

        {/* Asset category is now automatically determined from expense category - no manual selection needed */}
      </div>

      {depreciationType === 'immediate' && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t('depreciation.immediateInfo', 'This expense will be fully deducted in the current tax year.')}
        </p>
      )}

      {depreciationType === 'partial' && depreciationYears && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t('depreciation.partialInfo', `This expense will be depreciated over ${depreciationYears} years using ${depreciationMethod || 'linear'} method.`)}
        </p>
      )}
    </div>
  );
}
