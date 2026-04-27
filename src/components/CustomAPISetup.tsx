import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../ink.js';
import { useState } from 'react';
import chalk from 'chalk';
import { fetchModelsFromEndpoint, type FetchedModel } from '../utils/model/fetchModels.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import type { ModelOption } from '../utils/model/modelOptions.js';

export type CustomAPIConfig = {
  apiUrl: string
  apiKey: string
  providerType: 'openai' | 'anthropic'
}

const NO_PREFERENCE = '__NO_PREFERENCE__';

export type Props = {
  onClose: () => void
  onConfigComplete: (config: CustomAPIConfig) => void
}

export function CustomAPISetup({ onClose, onConfigComplete }: Props) {
  const $ = _c(13);
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [providerType, setProviderType] = useState<'openai' | 'anthropic'>('openai');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);

  let t1;
  if ($[0] !== apiUrl) {
    t1 = (value: string) => setApiUrl(value);
    $[0] = apiUrl;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const handleApiUrlChange = t1;

  let t2;
  if ($[2] !== apiKey) {
    t2 = (value: string) => setApiKey(value);
    $[2] = apiKey;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const handleApiKeyChange = t2;

  let t3;
  if ($[4] !== providerType) {
    t3 = (value: 'openai' | 'anthropic') => setProviderType(value);
    $[4] = providerType;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const handleProviderTypeChange = t3;

  let t4;
  if ($[6] !== isLoading || $[7] !== error) {
    t4 = async () => {
      if (!apiUrl.trim() || !apiKey.trim()) {
        setError('Please enter both API URL and API Key');
        return;
      }
      setIsLoading(true);
      setError(null);
      setFetchedModels([]);

      const result = await fetchModelsFromEndpoint(apiUrl, apiKey);

      if (result.success && result.models && result.models.length > 0) {
        setFetchedModels(result.models);
        setError(null);
      } else {
        setError(result.error || 'Failed to fetch models');
      }
      setIsLoading(false);
    };
    $[6] = isLoading;
    $[7] = error;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const handleFetchModels = t4;

  let t5;
  if ($[9] !== onClose || $[10] !== onConfigComplete || $[11] !== handleApiUrlChange || $[12] !== handleApiKeyChange || $[13] !== handleProviderTypeChange) {
    t5 = () => {
      onConfigComplete({
        apiUrl,
        apiKey,
        providerType,
      });
    };
    $[9] = onClose;
    $[10] = onConfigComplete;
    $[11] = handleApiUrlChange;
    $[12] = handleApiKeyChange;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const handleConfirm = t5;

  const renderLoading = isLoading;
  const renderError = error;

  return (
    <Box flexDirection="column" paddingBottom={1}>
      <Text bold={true} color="cyan">Custom API Configuration</Text>
      <Text dimColor={true}>Configure a custom API endpoint for model access</Text>

      <Box marginTop={1} flexDirection="column">
        <Text>API Provider:</Text>
        <Box flexDirection="row" gap={2}>
          <Text
            bold={providerType === 'openai'}
            color={providerType === 'openai' ? 'green' : undefined}
            onClick={() => handleProviderTypeChange('openai')}
          >
            [OpenAI Compatible]
          </Text>
          <Text
            bold={providerType === 'anthropic'}
            color={providerType === 'anthropic' ? 'green' : undefined}
            onClick={() => handleProviderTypeChange('anthropic')}
          >
            [Anthropic]
          </Text>
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>API URL:</Text>
        <Text dimColor={true}>Enter the base URL (e.g., https://api.openai.com/v1)</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>API Key:</Text>
        <Text dimColor={true}>Enter your API key</Text>
      </Box>

      {renderError && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box marginTop={2} flexDirection="row" gap={2}>
        <Text bold={true} color="green" onClick={handleFetchModels}>
          [Fetch Models]
        </Text>
        <Text bold={true} onClick={handleConfirm}>
          [Confirm]
        </Text>
        <Text dimColor={true} onClick={onClose}>
          [Cancel]
        </Text>
      </Box>
    </Box>
  );
}