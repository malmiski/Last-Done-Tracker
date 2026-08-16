import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const generateFileName = () => `img_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

export const processImage = async (uri: string): Promise<string> => {
  const isWeb = Platform.OS === 'web';
  const manipResult = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1200 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: isWeb }
  );

  if (isWeb) {
    return `data:image/jpeg;base64,${manipResult.base64}`;
  } else {
    return manipResult.uri;
  }
};

export const generateThumbnail = async (uri: string): Promise<string> => {
  const isWeb = Platform.OS === 'web';
  const manipResult = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 150 } }],
    { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: isWeb }
  );

  if (isWeb) {
    return `data:image/jpeg;base64,${manipResult.base64}`;
  } else {
    return manipResult.uri;
  }
};

export const saveBase64AsFile = async (base64String: string): Promise<string> => {
  if (Platform.OS === 'web') return base64String;

  try {
    const filename = generateFileName();
    const fileUri = `${FileSystem.documentDirectory}${filename}`;

    // Remove data URI prefix if present
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');

    await FileSystem.writeAsStringAsync(fileUri, base64Data, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return fileUri;
  } catch (error) {
    console.error('Error saving base64 to file:', error);
    return base64String; // Fallback to returning original string on failure
  }
};
