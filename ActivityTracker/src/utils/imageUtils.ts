import * as ImageManipulator from 'expo-image-manipulator';

export const processImage = async (uri: string): Promise<string> => {
  const manipResult = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1200 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  return `data:image/jpeg;base64,${manipResult.base64}`;
};

export const generateThumbnail = async (uri: string): Promise<string> => {
  const manipResult = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 150 } }],
    { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  return `data:image/jpeg;base64,${manipResult.base64}`;
};
