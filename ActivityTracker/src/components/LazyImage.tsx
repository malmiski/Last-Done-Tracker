import React, { useState, useEffect, useRef } from 'react';
import { View, Image, ImageProps, Platform, StyleProp, ViewStyle } from 'react-native';

interface LazyImageProps extends ImageProps {
  placeholderStyle?: StyleProp<ViewStyle>;
}

export const LazyImage: React.FC<LazyImageProps> = ({ source, style, placeholderStyle, ...props }) => {
  const [isVisible, setIsVisible] = useState(Platform.OS !== 'web');
  const containerRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '200px',
        threshold: 0.01,
      }
    );

    const el = containerRef.current;
    if (el) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  if (isVisible) {
    return <Image source={source} style={style} {...props} />;
  }

  return (
    <View
      ref={containerRef}
      style={[style, placeholderStyle, { backgroundColor: 'transparent' }]}
    />
  );
};

export default LazyImage;
