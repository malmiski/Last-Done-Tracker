import React, { useState, useEffect } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';

interface AutoHeightImageProps {
  source: { uri: string };
  width: number;
  style?: StyleProp<ImageStyle>;
}

const AutoHeightImage: React.FC<AutoHeightImageProps> = ({ source, width, style }) => {
  const [aspectRatio, setAspectRatio] = useState(1);

  useEffect(() => {
    if (source.uri) {
      Image.getSize(
        source.uri,
        (w, h) => {
          if (w && h) {
            setAspectRatio(w / h);
          }
        },
        (error) => {
          console.warn('Failed to get image size', error);
        }
      );
    }
  }, [source.uri]);

  return (
    <Image
      source={source}
      style={[{ width, aspectRatio, resizeMode: 'contain' }, style]}
    />
  );
};

export default AutoHeightImage;
