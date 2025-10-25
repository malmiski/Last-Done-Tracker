import * as Crypto from 'expo-crypto';

export const hashPin = async (pin: string): Promise<string> => {
  const hashedPin = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    pin
  );
  return hashedPin;
};

export const generateActivityId = async (activityName: string): Promise<string> => {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    activityName
  );
  return hash.substring(0, 4);
};
